#!/usr/bin/env python3
"""Seal the complete already exposed failed-deck prefix; never reselect sources.

The failed 64-product plan stays failed. This separate exploratory protocol
uses only its exact immutable returned source cases, without dataset/store reads.
"""
import argparse
import datetime
import importlib.util
import json
import pathlib

SCRIPT = pathlib.Path(__file__).with_name('prepare-source-gap-deck.py')
spec = importlib.util.spec_from_file_location('original_source_gap_rules', SCRIPT)
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
ROOT, flat, legacy = original.ROOT, original.flat, original.legacy
SEED = original.SEED
PROTOCOL = 'exposed_partial_source_gap_v1'
CLAIM_SCOPE = 'exploratory_source_exposed_pool'
ORIGINAL_CORE_SHA = '38db63f6c47026ca27732d1e4de73990c445657bc670e9c6b7354c83448f7575'
ORIGINAL_HELPER_SHA = '77b9aaccad1af51f5dcbfe7114e8b7c91d26c47cbf8cc28138efbb1607b46b9a'
HELPERS = {'scripts/prepare-source-gap-deck.py': ORIGINAL_HELPER_SHA, **original.HELPERS}
QUOTAS = original.QUOTAS
MINIMA = {'specification_gap': 1, 'model_detail_gap': 1, 'baseline_complete_control': 2}
FROZEN_FIELDS = {**original.FROZEN_FIELDS, 'format': 'ablatrix-source-gap-partial-candidate-freeze-v1'}
REQUIRED_CODE = original.REQUIRED_CODE | {
    'scripts/prepare-source-gap-partial-pool.py',
    'scripts/finalize-source-gap-partial-cohort.py',
    'scripts/test_prepare_source_gap_partial.py',
    'scripts/source-gap-partial-comparison.ts',
}
PROTOCOL_FIELDS = {
    'format': 'ablatrix-source-gap-partial-selection-protocol-v1',
    'selectionProtocol': PROTOCOL, 'selectionSeed': SEED,
    'maxima': QUOTAS, 'minima': MINIMA, 'minimumSelectedProducts': 4,
    'maximumSelectedProducts': 8, 'maximumNewAnswerAttempts': 16,
    'candidateEligibilityUsed': False, 'modelOutputsUsed': False,
    'caseReplacement': False, 'finalBaselineRevalidationRequired': True,
    'sourceExposed': True, 'claimScope': CLAIM_SCOPE,
}
checked_seal, source_cases = original.checked_seal, original.source_cases
coverage = original.coverage
PROTECTION_FIELDS = ('selectionCodeSha256', 'immutableHelperSha256', 'eligibilityAmendment',
    'priorCohorts', 'priorSourceReviews', 'consumedCohorts', 'exposedUnexecutedCohorts', 'inventoryInputs')
SOURCE_ONLY_FLAGS = ('generatedAnswersOrJudgmentsRead', 'modelOutputsUsed', 'candidateContextInspected')
INPUT_FLAGS = {'originalFailure': 'original_failure', 'partialExposure': 'partial_exposure',
    'originalCandidateFreeze': 'original_candidate_freeze', 'originalProtocol': 'original_protocol',
    'diagnostic': 'diagnostic', 'protectionProjection': 'source_protection_projection'}


def verify_helpers():
    if legacy.sha(SCRIPT.read_bytes()) != ORIGINAL_HELPER_SHA:
        raise ValueError('The original source-gap selector changed.')
    original.verify_helpers()


def artifact(path):
    resolved = pathlib.Path(path).resolve(strict=True)
    if ROOT not in resolved.parents or not resolved.is_file():
        raise ValueError('Input artifacts must be existing repository files.')
    raw = resolved.read_bytes()
    return {'path': resolved.relative_to(ROOT).as_posix(),
            'fileSha256': legacy.sha(raw), 'document': json.loads(raw)}


def candidate_freeze(path):
    value = artifact(path)
    document = value['document']
    if (set(document) != set(FROZEN_FIELDS) | {'createdAt', 'implementationSha256'} or
            any(document.get(key) != expected for key, expected in FROZEN_FIELDS.items())):
        raise ValueError('The exploratory candidate freeze differs from its fixed protocol.')
    try:
        stamp = datetime.datetime.fromisoformat(document['createdAt'].replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            raise ValueError('Timezone missing.')
    except (AttributeError, TypeError, ValueError):
        raise ValueError('Candidate freeze requires a valid ISO timestamp with timezone.') from None
    fingerprints = document['implementationSha256']
    if not isinstance(fingerprints, dict) or not REQUIRED_CODE <= set(fingerprints):
        raise ValueError('The exploratory freeze lacks required implementation files.')
    if fingerprints.get('server/workspace-source-coverage.ts') != ORIGINAL_CORE_SHA:
        raise ValueError('The original retrieval candidate must remain unchanged.')
    for name, expected in fingerprints.items():
        coverage.require_digest(expected)
        relative = pathlib.PurePosixPath(name)
        if (not relative.parts or relative.is_absolute() or '..' in relative.parts or
                not (name == 'package-lock.json' or relative.parts[0] in {'server', 'scripts'})):
            raise ValueError('Candidate implementation must bind repository code only.')
        actual = (ROOT / name).resolve(strict=True)
        if ROOT not in actual.parents or legacy.sha(actual.read_bytes()) != expected:
            raise ValueError('The exploratory implementation changed after freezing.')
    verify_helpers()
    return value


def protocol(path, freeze):
    value = artifact(path)
    document = value['document']
    checked_seal(document, 'protocolSha256', PROTOCOL_FIELDS['format'])
    if (set(document) != set(PROTOCOL_FIELDS) | {'candidateFreezeFileSha256', 'poolFileSha256', 'poolSize', 'protocolSha256'} or
            any(document.get(key) != expected for key, expected in PROTOCOL_FIELDS.items()) or
            document.get('candidateFreezeFileSha256') != freeze['fileSha256'] or
            type(document.get('poolSize')) is not int or not 4 <= document['poolSize'] <= 63):
        raise ValueError('Exploratory selection must retain its exact pre-review protocol.')
    coverage.require_digest(document['poolFileSha256'])
    return value


def reread_embedded(value):
    if not isinstance(value, dict) or set(value) != {'path', 'fileSha256', 'document'}:
        raise ValueError('Embedded artifacts require exact path, raw hash and document bindings.')
    relative = pathlib.PurePosixPath(value['path'])
    if relative.is_absolute() or '..' in relative.parts or str(relative) != value['path']:
        raise ValueError('Embedded artifact paths must be canonical repository-relative files.')
    if artifact(ROOT / value['path']) != value:
        raise ValueError('An embedded source-only artifact changed.')


def original_cases(inputs, freeze):
    """Check the whole captured failure; no selection or source inventory access."""
    if set(inputs) != set(INPUT_FLAGS) | {'rounds'} or not 1 <= len(inputs['rounds']) <= 8:
        raise ValueError('The complete original failure and all observed rounds are required.')
    artifacts = [inputs[key] for key in INPUT_FLAGS] + inputs['rounds']
    if len({value['path'] for value in artifacts}) != len(artifacts):
        raise ValueError('Original diagnostic inputs must identify distinct raw files.')
    for value in artifacts:
        reread_embedded(value)
    origin = inputs['originalFailure']['document']
    diagnostic = inputs['diagnostic']['document']
    protection = inputs['protectionProjection']['document']
    partial = inputs['partialExposure']['document']
    old_freeze = inputs['originalCandidateFreeze']['document']
    old_protocol = inputs['originalProtocol']['document']
    origin_fields = {'format', 'diagnostic', 'diagnosticFileSha256', 'source', 'selection',
        'originalCandidateFreezeFileSha256', 'originalProtocolFileSha256', 'replayInputsFileSha256',
        'sourceProtectionProjectionFileSha256'}
    if (set(origin) != origin_fields or origin['format'] != 'ablatrix-source-gap-partial-origin-v1' or
            origin['diagnostic'] != diagnostic or origin['diagnosticFileSha256'] != inputs['diagnostic']['fileSha256'] or
            origin['originalCandidateFreezeFileSha256'] != inputs['originalCandidateFreeze']['fileSha256'] or
            origin['originalProtocolFileSha256'] != inputs['originalProtocol']['fileSha256'] or
            origin['sourceProtectionProjectionFileSha256'] != inputs['protectionProjection']['fileSha256']):
        raise ValueError('Sanitized origin must bind the actual complete diagnostic and protection bytes.')
    if (protection.get('format') != 'ablatrix-source-gap-post-failure-protections-v1' or
            protection.get('provenance') != 'post_failure_reconstruction_from_unchanged_original_inputs' or
            protection.get('originalProcessPrintedThisProjection') is not False or
            protection.get('diagnosticSummaryFileSha256') != inputs['diagnostic']['fileSha256'] or
            protection.get('candidateFreezeFileSha256') != inputs['originalCandidateFreeze']['fileSha256'] or
            protection.get('protocolFileSha256') != inputs['originalProtocol']['fileSha256'] or
            protection.get('replayInputManifestFileSha256') != origin['replayInputsFileSha256'] or
            set(origin['selection']) != set(PROTECTION_FIELDS) | set(SOURCE_ONLY_FLAGS) or
            any(origin['selection'][key] != protection.get(key) for key in PROTECTION_FIELDS) or
            any(protection.get(key) is not False or origin['selection'][key] is not False for key in SOURCE_ONLY_FLAGS) or
            any(protection.get(key) is not False for key in ('newSelectionPerformed', 'newCsvReadsPerformed')) or
            protection.get('newProviderCalls') != 0):
        raise ValueError('Original source-only protection projections are detached or altered.')
    source = {'url': legacy.URL, 'sha256': legacy.TRAIN_SHA, 'commit': legacy.COMMIT,
              'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False}
    if origin['source'] != protection.get('source') or origin['source'] != source:
        raise ValueError('The original pinned train source identity must be preserved.')
    checked_seal(old_protocol, 'protocolSha256', original.PROTOCOL_FIELDS['format'])
    if ({key: value for key, value in old_protocol.items() if key != 'protocolSha256'} !=
            {**original.PROTOCOL_FIELDS, 'candidateFreezeFileSha256': inputs['originalCandidateFreeze']['fileSha256']}):
        raise ValueError('The original failed protocol must remain the fixed 64-product design.')
    if (set(old_freeze) != set(original.FROZEN_FIELDS) | {'createdAt', 'implementationSha256'} or
            any(old_freeze.get(key) != expected for key, expected in original.FROZEN_FIELDS.items()) or
            old_freeze['implementationSha256'].get('server/workspace-source-coverage.ts') != ORIGINAL_CORE_SHA or
            freeze['document']['implementationSha256'].get('server/workspace-source-coverage.ts') != ORIGINAL_CORE_SHA or
            any(old_freeze[key] != freeze['document'][key] for key in
                ('generationContract', 'retrievalContract', 'systemInstructionsSha256')) or
            protection['selectionCodeSha256'] != ORIGINAL_HELPER_SHA or
            protection['immutableHelperSha256'] != original.HELPERS):
        raise ValueError('The original retrieval candidate, generation contract or source helpers changed.')
    unchanged = ('inputArtifactBytesUnchangedDuringReplay', 'frozenCodeUnchangedDuringReplay',
        'sourceMetadataUnchangedDuringReplay', 'publicExposureProjectionUnchangedDuringReplay',
        'originalFailureLogUnchanged', 'originalPrepareDirectoryAbsent')
    if (diagnostic.get('format') != 'ablatrix-source-gap-failure-diagnostic-v1' or
            diagnostic.get('status') != 'reproduced_frozen_deck_insufficiency' or
            diagnostic.get('selectorExitCode') != 1 or diagnostic.get('unexpectedExceptionType') is not None or
            diagnostic.get('plannedProducts') != 64 or
            diagnostic.get('originalAttemptInventoryEquality') != 'unknown_original_attempt_wrote_no_source_inventory' or
            any(diagnostic.get(key) is not True for key in unchanged) or
            any(diagnostic.get(key) is not False for key in
                ('candidateContextsInspected', 'modelOutputsInspected', 'qualityClaimEligible', 'paidExecutionAuthorized')) or
            diagnostic.get('newProviderCalls') != 0 or
            diagnostic.get('roundsObserved') != len(inputs['rounds']) or
            diagnostic.get('completedRounds') != len(inputs['rounds']) - 1 or
            len(diagnostic.get('rounds', [])) != len(inputs['rounds']) or
            diagnostic.get('partialSourceExposureFileSha256') != inputs['partialExposure']['fileSha256']):
        raise ValueError('Only the intact reproduced failure can supply an exploratory pool.')
    cases = []
    strata = [name for name, count in original.base.STRATA for _ in range(count)]
    for number, (value, summary) in enumerate(zip(inputs['rounds'], diagnostic['rounds']), 1):
        row = value['document']
        selected = row['selectedSourceOnlyCases']
        passed = number < len(inputs['rounds'])
        if (row.get('format') != 'ablatrix-source-gap-failed-round-observation-v1' or
                row['round'] != number or row['seed'] != f'{SEED}:round:{number}' or
                row['selectedCount'] != len(selected) or row['inventory']['passed'] is not passed or
                (len(selected) != 8 if passed else not 0 <= len(selected) < 8) or
                summary['observationFileSha256'] != value['fileSha256'] or
                pathlib.PurePosixPath(value['path']).name != summary['observationFile'] or
                any(row.get(key) != value for key, value in summary.items()
                    if key not in {'observationFile', 'observationFileSha256'}) or
                [case['stratum'] for case in selected] != strata[:len(selected)] or
                any(row.get(key) is not False for key in
                    ('candidateContextsInspected', 'modelOutputsInspected', 'generationPerformed')) or
                row.get('newProviderCalls') != 0):
            raise ValueError('Every original round, including the failed prefix, must remain intact and ordered.')
        for case in selected:
            if (case['id'] != f"source-gap-train-{case['upstream']['qid']}" or
                    case['selectionRankSha256'] != legacy.sha(f"{row['seed']}:{case['stratum']}:{case['upstream']['qid']}")):
                raise ValueError('Original deterministic rank identities cannot change.')
            cases.append({**case, 'diagnosticRound': number})
    if (partial.get('format') != 'ablatrix-source-gap-partial-failure-exposure-v1' or
            partial.get('status') != 'failed_frozen_deck_not_a_benchmark' or partial.get('selectionSeed') != SEED or
            partial.get('cases') != cases or partial.get('selectedProducts') != len(cases) or
            diagnostic.get('partialSelectedProducts') != len(cases) or not 4 <= len(cases) < 64 or
            any(partial.get(key) is not False for key in
                ('generationPerformed', 'candidateContextsInspected', 'modelOutputsInspected', 'qualityClaimEligible')) or
            partial.get('newProviderCalls') != 0 or
            len({case['upstream']['qid'] for case in cases}) != len(cases)):
        raise ValueError('The exploratory pool must retain every returned case without dropping, replacing or duplicating.')
    source_cases({'cases': cases}, len(cases))
    protected = [*protection['priorCohorts'], *protection['consumedCohorts'], *protection['exposedUnexecutedCohorts']]
    if (len(protection['priorCohorts']) != 2 or len(protection['priorSourceReviews']) != 2 or
            len(protection['consumedCohorts']) != 1 or len(protection['exposedUnexecutedCohorts']) != 1 or
            any(case['product']['id'].upper() in {pid for item in protected for pid in item['productIds']}
                for case in cases)):
        raise ValueError('The original rejected, consumed and unexecuted protections must remain disjoint from the pool.')
    return cases


def verify_pool(pool, freeze):
    """Verify complete original-order preservation; never deduplicate a source pool."""
    document = pool['document']
    checked_seal(document, 'poolSha256', 'ablatrix-source-gap-exposed-pool-v1')
    cases = original_cases(document['inputArtifacts'], freeze)
    origin = document['inputArtifacts']['originalFailure']['document']
    if (document.get('selectionProtocol') != PROTOCOL or document.get('selectionSeed') != SEED or
            document.get('candidateFreeze') != freeze or document.get('cases') != cases or
            document.get('source') != origin['source'] or
            document.get('exposureAuditSha256') != document['inputArtifacts']['protectionProjection']['document']['exposureAuditSha256'] or
            document['selection'].get('selectionCodeSha256') != legacy.sha(pathlib.Path(__file__).read_bytes()) or
            document['selection'].get('immutableHelperSha256') != HELPERS or
            any(document['selection'].get(key) != origin['selection'][key] for key in PROTECTION_FIELDS[2:]) or
            any(document['selection'].get(key) is not False for key in SOURCE_ONLY_FLAGS) or
            document['selection'].get('sourceExposed') is not True or document['selection'].get('claimScope') != CLAIM_SCOPE or
            any(document['status'].get(key) is not False for key in
                ('generationPerformed', 'paidExecutionAuthorized', 'qualityClaimEligible'))):
        raise ValueError('The exposed pool freeze, source-only provenance or exact cases changed.')
    return cases


def prepare(args):
    # No source artifact is read until the new code and candidate are frozen.
    freeze = candidate_freeze(args.candidate_freeze)
    destination = pathlib.Path(args.prepare_dir).resolve()
    if destination.exists() or destination == ROOT / 'docs' or ROOT / 'docs' in destination.parents:
        raise ValueError('Preparation requires a new private directory; no overwrite or resume.')
    inputs = {key: artifact(getattr(args, flag)) for key, flag in INPUT_FLAGS.items()}
    inputs['rounds'] = [artifact(path) for path in args.round]
    cases = original_cases(inputs, freeze)
    origin = inputs['originalFailure']['document']
    pool = flat.bind({'format': 'ablatrix-source-gap-exposed-pool-v1',
        'selectionProtocol': PROTOCOL, 'selectionSeed': SEED, 'candidateFreeze': freeze,
        'source': origin['source'], 'inputArtifacts': inputs,
        'selection': {**origin['selection'], 'selectionCodeSha256': legacy.sha(pathlib.Path(__file__).read_bytes()),
            'immutableHelperSha256': HELPERS, 'sourceExposed': True, 'claimScope': CLAIM_SCOPE},
        'exposureAuditSha256': inputs['protectionProjection']['document']['exposureAuditSha256'],
        'status': {'generationPerformed': False, 'paidExecutionAuthorized': False, 'qualityClaimEligible': False,
                   'sourceExposed': True, 'claimScope': CLAIM_SCOPE}, 'cases': cases}, 'poolSha256')
    verify_pool({'document': pool}, freeze)
    if candidate_freeze(args.candidate_freeze) != freeze:
        raise ValueError('The exploratory freeze changed during source-only preparation.')
    destination.mkdir(parents=True, exist_ok=False)
    flat.write_new(destination / 'pool.json', pool)
    return {'screeningProducts': len(cases), 'sourceExposed': True, 'claimScope': CLAIM_SCOPE,
            'poolSha256': pool['poolSha256'], 'candidateContextInspected': False, 'newProviderCalls': 0,
            'paidExecutionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('candidate-freeze', 'original-failure', 'original-candidate-freeze', 'original-protocol',
                 'partial-exposure', 'diagnostic', 'source-protection-projection', 'prepare-dir'):
        parser.add_argument('--' + flag, required=True)
    parser.add_argument('--round', action='append', required=True)
    try:
        print(json.dumps(prepare(parser.parse_args()), indent=2))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f'Exploratory exposed source-gap preparation stopped: {error}\n')


if __name__ == '__main__':
    main()
