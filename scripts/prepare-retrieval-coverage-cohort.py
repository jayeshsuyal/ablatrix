#!/usr/bin/env python3
"""Prepare a fresh, source-only retrieval comparison; no generation or API calls.

Reuses the pinned source-calibration eligibility rules. Rejected drafts and a
previously executed cohort are protected separately; outcomes never rank cases.
"""
import argparse
import datetime
import importlib.util
import json
import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 'ablatrix-retrieval-coverage-2026-10-18-v1'
CASE_PREFIX = 'retrieval-coverage-train'
BASE_PATH = 'scripts/prepare-source-calibration-cohort.py'
BASE_SHA = 'e900cac3c050b6ffc187171ae97f0a14a76d8511dafad3b4e1229e5545add960'
spec = importlib.util.spec_from_file_location('retrieval_coverage_source_rules', ROOT / BASE_PATH)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
flat, legacy = base.flat, base.legacy
STRATA = base.STRATA
HELPERS = {BASE_PATH: BASE_SHA, base.HELPER_PATH: base.HELPER_SHA, **flat.HELPERS}
GENERATION_SHA = 'bee83f3637714b8c1d3345689d64b89748f2ba14887a6226ee5de33f53eb8d8f'
FROZEN_FIELDS = {
    'format': 'ablatrix-retrieval-coverage-candidate-freeze-v1', 'frozen': True,
    'status': 'experimental_not_promoted', 'retrievalContract': 'workspace-source-coverage-v1',
    'generationContract': 'workspace-answer-flat-sources-v1',
    'systemInstructionsSha256': GENERATION_SHA, 'selectionSeed': SEED,
    'qualityClaimEligible': False,
}
REQUIRED_CODE = frozenset(HELPERS) | {
    'scripts/prepare-retrieval-coverage-cohort.py', 'server/workspace-source-coverage.ts',
    'server/workspace-retrieval-context.ts', 'server/product-retrieval.ts',
    'server/product-corpus.ts', 'server/loop-types.ts', 'server/workspace-generation.ts',
    'server/feedback-provider.ts', 'server/citation-options.ts', 'package-lock.json',
}
ELIGIBILITY = {
    'rules': 'unchanged_source_calibration_revision_3',
    'fixedStrataUnchanged': True, 'newExperimentSeed': SEED,
    'rejectedDraftsRemainProtected': True, 'consumedCohortsRemainProtected': True,
    'modelOutputsUsed': False, 'generationInstructionsChanged': False,
}


def require_digest(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('Expected an exact SHA256 binding.')


def verify_helpers():
    if legacy.sha((ROOT / BASE_PATH).read_bytes()) != BASE_SHA:
        raise ValueError('Pinned source-only selector changed.')
    base.verify_helpers()


def candidate_freeze(path):
    raw = pathlib.Path(path).read_bytes()
    document = json.loads(raw)
    if (set(document) != set(FROZEN_FIELDS) | {'createdAt', 'implementationSha256'} or
            any(document.get(key) != value for key, value in FROZEN_FIELDS.items())):
        raise ValueError('Candidate freeze differs from the fixed retrieval comparison.')
    try:
        timestamp = datetime.datetime.fromisoformat(document['createdAt'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError('Timezone missing.')
    except (AttributeError, TypeError, ValueError):
        raise ValueError('Candidate freeze requires an ISO timestamp with timezone.') from None
    fingerprints = document['implementationSha256']
    if not isinstance(fingerprints, dict) or not REQUIRED_CODE <= set(fingerprints):
        raise ValueError('Candidate freeze is missing required implementation bindings.')
    for name, expected in fingerprints.items():
        require_digest(expected)
        if not isinstance(name, str) or not name:
            raise ValueError('Candidate implementation must bind repository code only.')
        relative = pathlib.PurePosixPath(name)
        if (not relative.parts or relative.is_absolute() or '..' in relative.parts or
                not (name == 'package-lock.json' or relative.parts[0] in {'server', 'scripts'})):
            raise ValueError('Candidate implementation must bind repository code only.')
        actual = (ROOT / name).resolve(strict=True)
        if ROOT not in actual.parents or legacy.sha(actual.read_bytes()) != expected:
            raise ValueError('Candidate implementation changed after freezing.')
    verify_helpers()
    return {'fileSha256': legacy.sha(raw), 'document': document}


def consumed_cohort(cohort_path, review_path, execution_path):
    """Allowlisted existing execution metadata protects all eight source pools.

    The metadata is a local operator record, not provider authentication. This
    reader never follows references to generated answers or grading artifacts.
    """
    prior = base.prior_cohort(cohort_path)
    cohort_raw = pathlib.Path(cohort_path).read_bytes()
    if legacy.sha(cohort_raw) != prior['projection']['fileSha256']:
        raise ValueError('Consumed cohort changed while reading.')
    case_ids = [case['id'] for case in json.loads(cohort_raw)['cases']]
    if len(set(case_ids)) != 8:
        raise ValueError('Consumed cohort requires eight distinct case identities.')
    review_raw = pathlib.Path(review_path).read_bytes()
    review = json.loads(review_raw)
    if (review.get('status') != 'passed' or
            review.get('provenance') != 'independent_ai_source_and_family_review' or
            review.get('cohortFileSha256') != prior['projection']['fileSha256'] or
            [case.get('caseId') for case in review.get('cases', [])] != case_ids or
            any(case.get('sourceScopeReviewed') is not True or
                case.get('familySeparationReviewed') is not True for case in review['cases'])):
        raise ValueError('Consumed cohort needs its passed, one-to-one pre-generation source review.')
    execution_raw = pathlib.Path(execution_path).read_bytes()
    execution = json.loads(execution_raw)
    fields = {'format', 'cohortFileSha256', 'sourceReviewFileSha256', 'planSha256',
              'generationPerformed', 'newProviderAttempts', 'attempts', 'modelOutputsUsed',
              'generatedAnswersOrJudgmentsRead', 'sourceExecutionRecordFileSha256', 'provenance'}
    if (set(execution) != fields or
            execution.get('format') != 'ablatrix-consumed-source-cohort-execution-v1' or
            execution.get('cohortFileSha256') != prior['projection']['fileSha256'] or
            execution.get('sourceReviewFileSha256') != legacy.sha(review_raw) or
            execution.get('provenance') != 'allowlisted_existing_execution_metadata_for_full_cohort_exclusion' or
            execution.get('generationPerformed') is not True or
            execution.get('modelOutputsUsed') is not False or
            execution.get('generatedAnswersOrJudgmentsRead') is not False):
        raise ValueError('Consumed execution must be exact allowlisted metadata bound to the cohort and review.')
    for key in ('planSha256', 'sourceExecutionRecordFileSha256'):
        require_digest(execution[key])
    attempts = execution['attempts']
    if (not isinstance(attempts, list) or type(execution['newProviderAttempts']) is not int or
            not 1 <= len(attempts) <= 16 or execution['newProviderAttempts'] != len(attempts)):
        raise ValueError('Consumed execution requires one to sixteen recorded provider attempts.')
    identities, slots = set(), set()
    for attempt in attempts:
        if (not isinstance(attempt, dict) or set(attempt) != {'caseId', 'arm', 'attemptId'} or
                attempt['caseId'] not in case_ids or attempt['arm'] not in {'baseline', 'candidate'} or
                not isinstance(attempt['attemptId'], str) or
                not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', attempt['attemptId'])):
            raise ValueError('Consumed provider attempt is outside the frozen case/arm scope.')
        identities.add(attempt['attemptId'])
        slots.add((attempt['caseId'], attempt['arm']))
    if len(identities) != len(attempts) or len(slots) != len(attempts):
        raise ValueError('Consumed provider attempts and case/arm slots must be unique.')
    return {'cases': prior['cases'], 'projection': {
        **prior['projection'], 'sourceReviewFileSha256': legacy.sha(review_raw),
        'executionFileSha256': legacy.sha(execution_raw), 'generationPerformed': True,
        'planSha256': execution['planSha256'], 'newProviderAttempts': len(attempts),
        'attemptScopeSha256': legacy.sha(legacy.compact(attempts)),
        'protectionScope': 'entire_cohort_after_any_recorded_provider_attempt',
        'executionMetadataProvenance': 'allowlisted_existing_execution_metadata',
    }}


def protected_inputs(args):
    if len(args.prior_cohort) != 2 or len(args.prior_source_review) != 2:
        raise ValueError('Protect both rejected prior drafts and their two independent rejection reviews.')
    priors = [base.prior_cohort(path) for path in args.prior_cohort]
    projections = [prior['projection'] for prior in priors]
    if len({item['fileSha256'] for item in projections}) != 2:
        raise ValueError('Rejected prior drafts must be distinct.')
    reviews = base.prior_source_reviews(args.prior_source_review, projections)
    consumed = consumed_cohort(args.consumed_cohort, args.consumed_source_review,
                               args.consumed_execution_record)
    consumed_projection = consumed['projection']
    if (consumed_projection['fileSha256'] in {item['fileSha256'] for item in projections} or
            any(set(item['productIds']) & set(consumed_projection['productIds']) for item in projections)):
        raise ValueError('Consumed and rejected cohorts must be distinct protection records.')
    return priors, reviews, consumed


def inventory_inputs(args):
    if len(args.workspace_db) != 2 or len(args.comparison_db) != 1:
        raise ValueError('Exactly two current workspaces and one comparison inventory are required.')
    paths = [str(pathlib.Path(path).resolve(strict=True)) for path in args.workspace_db + args.comparison_db]
    if len(set(paths)) != 3:
        raise ValueError('Inventory inputs must identify three distinct existing stores.')
    return {'workspaceCount': 2, 'comparisonCount': 1,
            'canonicalPathSha256': sorted(legacy.sha(path) for path in paths)}


def prepare(args):
    # Freeze and all implementation hashes are checked before any CSV/DB read.
    freeze = candidate_freeze(args.candidate_freeze)
    destination = pathlib.Path(args.prepare_dir).resolve()
    if destination == ROOT / 'docs' or ROOT / 'docs' in destination.parents or destination.exists():
        raise ValueError('Preparation requires a new private directory; no overwrite or resume.')
    inventories = inventory_inputs(args)
    priors, reviews, consumed = protected_inputs(args)
    prior_projection = [prior['projection'] for prior in priors]
    consumed_projection = [consumed['projection']]
    rows = flat.load_rows(args.train)
    # The existing helper reads SQL source projections only, never full run JSON.
    args.exposure_audit = None
    audit = flat.exposure(args, rows)
    cases, decisions, summary = base.select(rows, audit, [*priors, consumed],
                                           seed=SEED, case_prefix=CASE_PREFIX)
    common = {'selectionSeed': SEED, 'eligibilityAmendment': ELIGIBILITY,
              'priorCohorts': prior_projection, 'priorSourceReviews': reviews,
              'consumedCohorts': consumed_projection, 'inventoryInputs': inventories,
              'selectionCodeSha256': legacy.sha(pathlib.Path(__file__).read_bytes()),
              'immutableHelperSha256': HELPERS}
    selection = flat.bind({
        'format': 'ablatrix-retrieval-coverage-selection-audit-v1', **common,
        'candidateFreezeFileSha256': freeze['fileSha256'],
        'exposureAuditSha256': audit['auditSha256'], 'inventory': summary,
        'decisions': decisions, 'generatedAnswersOrJudgmentsRead': False,
        'modelOutputsUsed': False, 'generationPerformed': False, 'newProviderCalls': 0,
    }, 'selectionAuditSha256')
    destination.mkdir(parents=True, exist_ok=False)
    flat.write_new(destination / 'exposure-audit.json', audit)
    flat.write_new(destination / 'selection-audit.json', selection)
    if not summary['passed']:
        raise ValueError(summary['stopReason'] + ' Private rejection audits retained.')
    cohort = flat.bind({
        'format': 'ablatrix-retrieval-coverage-cohort-v1', 'selectionSeed': SEED,
        'candidateFreeze': freeze,
        'source': {'url': legacy.URL, 'sha256': legacy.TRAIN_SHA, 'commit': legacy.COMMIT,
                   'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False},
        'selection': {**common,
            'method': 'First SHA256-ranked eligible question per fixed stratum after source-only exposure, rejected-draft and consumed-cohort protection; no model outcomes.',
            'strata': [{'name': name, 'count': count} for name, count in STRATA],
            'labelOrAnswerColumnsUsed': False, 'modelOutputsUsed': False,
            'sourcePool': 'Unchanged complete source-only pool construction from the pinned selector helpers.',
            'maximumCompleteSourceParentCharacters': 1500},
        'inventory': summary, 'exposureAuditSha256': audit['auditSha256'],
        'selectionAuditSha256': selection['selectionAuditSha256'],
        'status': {'privateCandidateOnly': True, 'cohortFrozen': False, 'retrievalFrozen': False,
                   'independentSourceAndFamilyReview': 'pending', 'generationPerformed': False,
                   'humanJudgments': 0, 'qualityClaimEligible': False, 'paidExecutionAuthorized': False},
        'executionPlan': {'comparison': 'two first answers using different retrieval contexts and the same shipped generation contract',
                          'caseCount': 8, 'maximumNewAnswerAttempts': 16,
                          'generationContract': FROZEN_FIELDS['generationContract'],
                          'retrievalCandidateContract': FROZEN_FIELDS['retrievalContract'],
                          'generationSources': 'Freeze baseline and candidate parent selections separately without changing source bodies.',
                          'fullReviewSourceLimit': 128, 'fullReviewSourceCharacters': 2000,
                          'webCalls': 0, 'automaticRetries': 0, 'caseReplacement': False,
                          'paidExecutionAuthorized': False},
        'cases': cases}, 'cohortSha256')
    flat.write_new(destination / 'cohort.json', cohort)
    if candidate_freeze(args.candidate_freeze) != freeze or inventory_inputs(args) != inventories:
        raise ValueError('Frozen implementation or inventory paths changed; artifacts remain unapproved.')
    final_priors, final_reviews, final_consumed = protected_inputs(args)
    if ([item['projection'] for item in final_priors] != prior_projection or
            final_reviews != reviews or [final_consumed['projection']] != consumed_projection):
        raise ValueError('Protected source records changed; artifacts remain unapproved.')
    return {'cases': len(cases), 'sources': sum(len(case['sources']) for case in cases),
            'protectedRejectedCohorts': len(priors), 'protectedConsumedCohorts': 1,
            'cohortSha256': cohort['cohortSha256'], 'newProviderCalls': 0,
            'modelOutputsUsed': False, 'paidExecutionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('candidate-freeze', 'train', 'prepare-dir', 'consumed-cohort',
                 'consumed-source-review', 'consumed-execution-record'):
        parser.add_argument('--' + flag, required=True)
    for flag in ('workspace-db', 'comparison-db', 'prior-cohort', 'prior-source-review'):
        parser.add_argument('--' + flag, action='append', default=[])
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args), indent=2))
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Retrieval-coverage preparation stopped: {error}\n')


if __name__ == '__main__':
    main()
