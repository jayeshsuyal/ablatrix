#!/usr/bin/env python3
"""Select eight source-gap cases from a fixed, independently reviewed deck.

No dataset, database, candidate retrieval, generated answer or provider is read.
The selected packet still requires final-index baseline and semantic revalidation.
"""
import argparse
import importlib.util
import json
import pathlib

SCRIPT = pathlib.Path(__file__).with_name('prepare-source-gap-deck.py')
spec = importlib.util.spec_from_file_location('source_gap_deck_rules', SCRIPT)
deck_rules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deck_rules)
ROOT, flat, legacy = deck_rules.ROOT, deck_rules.flat, deck_rules.legacy


def reviewed_selection(deck, baseline, review, protocol):
    cases = deck['document']['cases']
    rows, assessed = baseline['document'], review['document']
    baseline_fields = {'format', 'scope', 'inputFileSha256', 'corpusSha256', 'implementationSha256',
                       'results', 'providerCalls', 'generationPerformed', 'candidateContextInspected', 'sha256'}
    if (set(rows) != baseline_fields or rows.get('format') != 'ablatrix-source-gap-baseline-v1' or rows.get('scope') != 'screening_deck' or
            rows.get('inputFileSha256') != deck['fileSha256'] or rows.get('providerCalls') != 0 or
            rows.get('generationPerformed') is not False or rows.get('candidateContextInspected') is not False or
            [row['caseId'] for row in rows.get('results', [])] != [case['id'] for case in cases]):
        raise ValueError('Screening requires all 64 baseline-only retrieval results in fixed deck order.')
    # Bind exact raw bytes here. The JS runner verifies its insertion-order seal;
    # Python must not claim JS-compatible floating-point reserialization.
    deck_rules.coverage.require_digest(rows['sha256'])
    review_fields = {'format', 'status', 'provenance', 'protocolFileSha256', 'deckFileSha256',
                     'baselineFileSha256', 'modelOutputsInspected', 'candidateContextInspected', 'cases'}
    if (not review_fields <= set(assessed) or set(assessed) - review_fields - {'limitations'} or
            assessed.get('format') != 'ablatrix-source-gap-review-v1' or assessed.get('status') != 'completed' or
            assessed.get('provenance') != 'independent_ai_source_gap_review' or
            assessed.get('protocolFileSha256') != protocol['fileSha256'] or
            assessed.get('deckFileSha256') != deck['fileSha256'] or
            assessed.get('baselineFileSha256') != baseline['fileSha256'] or
            assessed.get('modelOutputsInspected') is not False or
            assessed.get('candidateContextInspected') is not False or
            [row.get('caseId') for row in assessed.get('cases', [])] != [case['id'] for case in cases]):
        raise ValueError('Independent source-gap review must cover the entire baseline-only deck.')
    chosen, counts = [], dict.fromkeys(deck_rules.QUOTAS, 0)
    for case, context, row in zip(cases, rows['results'], assessed['cases']):
        if set(context) != {'caseId', 'indexRetrieval', 'baseline', 'baselineContextSha256'}:
            raise ValueError('Screening retrieval cannot include candidate results or outcomes.')
        row_fields = {'caseId', 'sourceGapGroup', 'baselineContextSha256', 'sourcePoolSha256',
                      'sourceScopeReviewed', 'baselineAndTitleReviewed', 'originalQuestionsReviewed',
                      'noEquivalentFactInBaseline', 'baselineComplete', 'designatedFacts', 'notes'}
        group = row.get('sourceGapGroup')
        if (set(row) != row_fields or group not in {*deck_rules.QUOTAS, 'ineligible_or_uncertain'} or
                row.get('baselineContextSha256') != context['baselineContextSha256'] or
                row.get('sourcePoolSha256') != case['sourcePoolSha256'] or
                any(row.get(key) is not True for key in ('sourceScopeReviewed', 'baselineAndTitleReviewed', 'originalQuestionsReviewed')) or
                type(row.get('noEquivalentFactInBaseline')) is not bool or type(row.get('baselineComplete')) is not bool or
                not isinstance(row.get('notes'), str) or len(row['notes']) < 10):
            raise ValueError('Every screening judgment must bind complete sources, baseline and original question scope.')
        facts = row.get('designatedFacts')
        if not isinstance(facts, list):
            raise ValueError('Source-gap facts must be explicit, including an empty list for uncertain cases.')
        sources = {source['id']: source for source in case['sources']}
        passages = context['baseline']['passages']
        deck_rules.coverage.require_digest(context['baselineContextSha256'])
        if not passages or len({source['id'] for source in passages}) != len(passages):
            raise ValueError('Screening baseline requires distinct literal source parents.')
        for passage in passages:
            source = sources.get(passage['id'])
            if (source is None or passage.get('productId') != case['product']['id'] or
                    passage.get('text') != source['text'] or passage.get('source') != source['label'] or
                    passage.get('originalQuestion') != source['originalQuestion'] or
                    passage.get('reference') != source['label'] or
                    passage.get('sha256') != legacy.sha(source['text'])):
                raise ValueError('Screening baseline body or question scope differs from its source pool.')
        for fact in facts:
            if (set(fact) != {'fact', 'sourceIds', 'quote', 'qualification'} or
                    not all(isinstance(fact.get(key), str) and fact[key].strip() for key in ('fact', 'quote', 'qualification')) or
                    not isinstance(fact['sourceIds'], list) or not fact['sourceIds'] or
                    len(set(fact['sourceIds'])) != len(fact['sourceIds']) or
                    any(source_id not in sources for source_id in fact['sourceIds']) or
                    not any(fact['quote'] in sources[source_id]['text'] for source_id in fact['sourceIds'])):
                raise ValueError('Designated facts require literal full-source support; question-only mentions cannot qualify.')
        if group in {'specification_gap', 'model_detail_gap'}:
            if not facts or row.get('noEquivalentFactInBaseline') is not True or row.get('baselineComplete') is not False:
                raise ValueError('A targeted gap must be a useful fact missing from baseline and product title.')
            if any(passage['id'] in fact['sourceIds'] and fact['quote'] in passage['text']
                   for fact in facts for passage in passages):
                raise ValueError('A designated gap is already supported by its cited source body in the baseline.')
        elif group == 'baseline_complete_control':
            if (not facts or row.get('baselineComplete') is not True or row.get('noEquivalentFactInBaseline') is not False or
                    any(not any(passage['id'] in fact['sourceIds'] and fact['quote'] in passage['text']
                                for passage in passages) for fact in facts)):
                raise ValueError('Controls require useful supported facts quoted from the actual baseline bodies.')
        if group in counts and counts[group] < deck_rules.QUOTAS[group]:
            counts[group] += 1
            chosen.append({**case, 'sourceGapGroup': group, 'designatedFacts': facts,
                           'screeningBaselineContextSha256': context['baselineContextSha256']})
    if counts != deck_rules.QUOTAS:
        raise ValueError('Insufficient independently supported gaps/controls; stop without replacement or reseeding.')
    return chosen


def finalize(args):
    freeze = deck_rules.candidate_freeze(args.candidate_freeze)
    protocol = deck_rules.protocol(args.protocol, freeze)
    destination = pathlib.Path(args.prepare_dir).resolve()
    if destination.exists() or destination == ROOT / 'docs' or ROOT / 'docs' in destination.parents:
        raise ValueError('Finalization requires a new private directory; no overwrite or resume.')
    inputs = {'protocol': protocol, **{name: deck_rules.artifact(getattr(args, name))
                                     for name in ('deck', 'baseline', 'gapReview')}}
    if len({value['path'] for value in inputs.values()}) != 4:
        raise ValueError('Screening inputs must be four distinct artifacts.')
    deck = inputs['deck']['document']
    deck_rules.checked_seal(deck, 'deckSha256', 'ablatrix-source-gap-deck-v1')
    deck_rules.source_cases(deck, 64)
    if (deck.get('selectionSeed') != deck_rules.SEED or deck.get('selectionProtocol') != deck_rules.PROTOCOL or
            deck.get('protocolFileSha256') != protocol['fileSha256'] or
            deck.get('candidateFreeze') != freeze or
            deck['selection'].get('selectionCodeSha256') != legacy.sha(SCRIPT.read_bytes()) or
            deck['selection'].get('immutableHelperSha256') != deck_rules.HELPERS or
            deck['selection'].get('candidateContextInspected') is not False or
            deck['selection'].get('modelOutputsUsed') is not False or
            deck['selection'].get('generatedAnswersOrJudgmentsRead') is not False):
        raise ValueError('Deck selection must retain its exact pre-read freeze and source-only code.')
    cases = reviewed_selection(inputs['deck'], inputs['baseline'], inputs['gapReview'], protocol)
    common = {**deck['selection'], 'selectionProtocol': deck_rules.PROTOCOL,
              'selectionSeed': deck_rules.SEED, 'inputArtifacts': inputs,
              'finalizationCodeSha256': legacy.sha(pathlib.Path(__file__).read_bytes()),
              'candidateEligibilityUsed': False, 'labelOrAnswerColumnsUsed': False}
    selection = flat.bind({
        'format': 'ablatrix-source-gap-selection-audit-v1', **common,
        'candidateFreezeFileSha256': freeze['fileSha256'],
        'exposureAuditSha256': deck['exposureAuditSha256'],
        'inventory': {'passed': True, 'screenedProducts': 64, 'selectedProducts': 8, 'quotas': deck_rules.QUOTAS},
        'selectedCaseIds': [case['id'] for case in cases],
        'decisions': [{'stage': 'ranked_selection', 'selected': True, 'eligible': True,
                       'qid': case['upstream']['qid'], 'productId': case['product']['id'],
                       'stratum': case['stratum'], 'rankSha256': case['selectionRankSha256'],
                       'selectionBasis': 'first_independently_qualified_in_frozen_deck_order'} for case in cases],
        'generationPerformed': False, 'newProviderCalls': 0,
    }, 'selectionAuditSha256')
    cohort = flat.bind({
        'format': 'ablatrix-source-gap-cohort-v1', 'selectionSeed': deck_rules.SEED,
        'selectionProtocol': deck_rules.PROTOCOL, 'candidateFreeze': deck['candidateFreeze'],
        'source': deck['source'], 'selection': common, 'inventory': selection['inventory'],
        'exposureAuditSha256': deck['exposureAuditSha256'],
        'selectionAuditSha256': selection['selectionAuditSha256'],
        'status': {'privateCandidateOnly': True, 'generationPerformed': False,
                   'finalBaselineEligibility': 'pending_independent_revalidation',
                   'humanJudgments': 0, 'qualityClaimEligible': False, 'paidExecutionAuthorized': False},
        'executionPlan': {'caseCount': 8, 'maximumNewAnswerAttempts': 16,
                          'generationContract': deck_rules.FROZEN_FIELDS['generationContract'],
                          'retrievalCandidateContract': deck_rules.FROZEN_FIELDS['retrievalContract'],
                          'webCalls': 0, 'automaticRetries': 0, 'caseReplacement': False,
                          'finalBaselineRevalidationRequired': True, 'candidateMissesRetained': True,
                          'paidExecutionAuthorized': False}, 'cases': cases}, 'cohortSha256')
    if (deck_rules.candidate_freeze(args.candidate_freeze) != freeze or
            any(deck_rules.artifact(ROOT / value['path']) != value for value in inputs.values())):
        raise ValueError('Frozen code or source-only screening inputs changed during finalization.')
    destination.mkdir(parents=True, exist_ok=False)
    flat.write_new(destination / 'selection-audit.json', selection)
    flat.write_new(destination / 'cohort.json', cohort)
    return {'selectedProducts': 8, 'quotas': deck_rules.QUOTAS, 'newProviderCalls': 0,
            'candidateContextInspected': False, 'finalBaselineEligibility': 'pending_independent_revalidation',
            'cohortSha256': cohort['cohortSha256'], 'paidExecutionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('candidate-freeze', 'protocol', 'deck', 'baseline', 'prepare-dir'):
        parser.add_argument('--' + flag, required=True)
    parser.add_argument('--gap-review', dest='gapReview', required=True)
    try:
        print(json.dumps(finalize(parser.parse_args()), indent=2))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f'Source-gap finalization stopped: {error}\n')


if __name__ == '__main__':
    main()
