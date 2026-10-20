#!/usr/bin/env python3
"""Rebuild the APQA exclusion union from verified prior freezes and exposures."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIELDS = ('productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourcePacketFingerprints', 'sourceBodyFingerprints')


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def merge_exposure(base, consumed, custodian, metadata, norm, body_fingerprint, scoped_fingerprint):
    """Pure union. No candidate outcome or generated answer is an input."""
    values = {field: set(base[field]) | set(consumed[field]) for field in FIELDS}
    assert consumed['custodianRecordFileSha256'] == custodian['fileSha256'], 'Consumed projection must bind the actual failed custodian.'
    decisions = custodian['document']['decisions']
    assert len(decisions) == custodian['document']['finiteQuestionDenominator'], 'Retain every failed finite decision.'
    for field in FIELDS:
        actual = {value for decision in decisions for value in decision.get('inspectedExposure', {}).get(field, [])}
        assert actual <= set(consumed[field]), 'The consumed projection omitted inspected rejected exposure: ' + field
        values[field].update(actual)
    incidental = []
    for item in metadata['incidentalDocumentationExposure']:
        assert item['productExcluded'] is True and item['familySeparationStatus'] == 'unqualified_until_checked'
        values['productIds'].add(item['asin'])
        for text in (item['questionText'], item['answerText'], item['literalObservedQuestionAnswerBody']):
            values['sourceBodyFingerprints'].add(body_fingerprint({'text': text}))
        values['sourcePacketFingerprints'].add(scoped_fingerprint({'text': item['answerText'], 'originalQuestion': item['questionText']}))
        values['modelIdentifiers'].update(norm(x) for x in item.get('modelAliases', []))
        values['canonicalFamilyTitles'].update(norm(x) for x in item.get('familyAliases', []))
        incidental.append(item['asin'])
    assert sorted(incidental) == ['B000050B6Z'], 'The known incidental unknown family must remain explicit.'
    return {**{key: sorted(value) for key, value in values.items()}, 'incidentalUnknownFamilyProductIds': sorted(incidental)}


def verify_failed_custodian(document, seal):
    assert document.get('format') == 'ablatrix-v6-source-custodian-record-v3', 'Use the actual v3 failed custodian format.'
    assert document.get('pool') == {'format': 'ablatrix-fresh-source-only-pool-v1', 'cases': []}, 'Preserve the actual empty failed-pool wrapper.'
    assert document.get('screeningPacketDenominator') == 0 and document.get('stopReason') == 'insufficient_fixed_pool_without_replacement'
    assert all(document.get(key) is False for key in ('modelOutputsUsed', 'answerColumnsUsed', 'candidateContextInspected'))
    assert document.get('providerCalls') == 0 and document.get('paidPlan') is None
    body = dict(document); expected = body.pop('custodianSha256')
    assert expected == seal(body), 'The actual failed custodian seal changed.'


def build(root, freeze_dir, consumed_name, metadata_name, additional_exposures=()):
    v3 = load_module('apqa_prior_v3', root/'scripts/prepare-fresh-validation-v3.py')
    prior = v3.verify_freeze(root, freeze_dir)
    v1 = v3.v1
    consumed = v1.read(root, consumed_name)
    metadata = v1.read(root, metadata_name)
    assert consumed['document']['format'] == 'ablatrix-consumed-source-only-exposure-v1'
    assert consumed['document']['modelOutputsUsed'] is False and consumed['document']['answerColumnsUsed'] is False
    custodian = v1.read(root, consumed['document']['custodianRecordPath'])
    verify_failed_custodian(custodian['document'], v3.seal)
    union = merge_exposure(prior['history']['document'], consumed['document'], custodian, metadata['document'],
                           v1.norm, v3.body_fingerprint, v1.scoped_fingerprint)
    descriptors = [prior['protocol'], prior['freeze'], prior['history'], prior['contracts']['projection'], consumed, custodian, metadata]
    prefix_commitments = []
    for name in additional_exposures:
        artifact = v1.read(root, name); extra = artifact['document']
        assert extra.get('format') == 'ablatrix-amazon-pqa-consumed-exposure-v1' and extra.get('nextProtocolMustExcludeThisExposure') is True
        assert extra.get('semanticParseAttempted') is True and extra.get('wholePrefixConsumed') is True
        assert extra.get('providerCalls') == 0 and extra.get('candidateOutputsUsed') is False
        for key in FIELDS:
            assert isinstance(extra.get('consumedExposure', {}).get(key), list), 'Additional APQA exposure must retain every identifier/hash array.'
            union[key] = sorted(set(union[key]) | set(extra['consumedExposure'][key]))
        for prefix in extra['sourcePrefixes']:
            assert all(key in prefix for key in ('key', 'versionId', 'sha256', 'range')), 'Retain exact consumed source-prefix identity.'
            assert len(prefix['sha256']) == 64
            prefix_commitments.append(prefix)
        descriptors.append(artifact)
    document = {'format': 'ablatrix-amazon-pqa-protected-history-v1', 'completeHistoricalUnion': True,
                'priorFreezeDirectory': str(pathlib.Path(freeze_dir)), 'consumedExposurePath': consumed_name,
                'metadataExposurePath': metadata_name, 'inputArtifacts': [{k: value[k] for k in ('path', 'fileSha256')} for value in descriptors],
                'priorPublicArtifactSha256': prior['history']['document']['artifactSha256'],
                'priorEmbeddedArtifactSha256': prior['history']['document']['embeddedArtifactSha256'],
                'normalization': {'id': 'python_nfkc_casefold_whitespace_v1', 'pythonVersion': sys.version.split()[0], 'unicodeVersion': unicodedata.unidata_version,
                                  'bodyFingerprint': 'sha256(compact_utf8_json([norm(body)]))',
                                  'scopedFingerprint': 'sha256(compact_utf8_json([norm(body),norm(originalQuestion)]))'},
                **union, 'candidateOutputsUsed': False, 'sourceOnly': True, 'providerCalls': 0,
                'humanSourceCheckedAnswers': 0, 'qualityClaimEligible': False, 'activationAuthorized': False}
    if additional_exposures:
        document.update(additionalExposurePaths=list(additional_exposures), consumedSourcePrefixes=prefix_commitments,
                        unresolvedPriorSemanticExposure=any(v1.read(root, name)['document'].get('unresolvedSemanticExposure') is True for name in additional_exposures))
    return {**document, 'historySha256': v1.seal(document)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze-dir'); parser.add_argument('--consumed'); parser.add_argument('--metadata'); parser.add_argument('--out'); parser.add_argument('--verify'); parser.add_argument('--additional-exposure', action='append', default=[])
    args = parser.parse_args()
    v1 = load_module('apqa_prior_v1', ROOT/'scripts/prepare-fresh-validation-v1.py')
    if args.verify:
        artifact = v1.read(ROOT, args.verify); saved = artifact['document']
        actual = build(ROOT, saved['priorFreezeDirectory'], saved['consumedExposurePath'], saved['metadataExposurePath'], saved.get('additionalExposurePaths', []))
        assert actual == saved, 'Complete APQA protected history no longer reconstructs from exact prior artifacts.'
        result = {'format': 'ablatrix-amazon-pqa-history-proof-v1', 'historyFileSha256': artifact['fileSha256'],
                  'counts': {key: len(actual[key]) for key in FIELDS}, 'providerCalls': 0}
    else:
        assert all((args.freeze_dir, args.consumed, args.metadata, args.out)), 'Supply freeze, consumed exposure, metadata and a new output.'
        document = build(ROOT, args.freeze_dir, args.consumed, args.metadata, args.additional_exposure)
        v1.write_new(args.out, document); pathlib.Path(args.out).chmod(0o600)
        result = {'format': 'ablatrix-amazon-pqa-history-result-v1', 'output': args.out,
                  'fileSha256': hashlib.sha256(pathlib.Path(args.out).read_bytes()).hexdigest(),
                  'counts': {key: len(document[key]) for key in FIELDS}, 'providerCalls': 0}
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, ValueError, OSError, KeyError, TypeError) as error:
        print('APQA history: ' + str(error), file=sys.stderr); sys.exit(1)
