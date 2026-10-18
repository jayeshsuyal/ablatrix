#!/usr/bin/env python3
"""Prepare eight private, label-blind first-answer comparison cases.

Preparation requires the already frozen candidate, an existing pinned train CSV
and explicit current source-metadata inventories (or their frozen replay). It
never generates answers, downloads data, reads a spending ledger or writes a DB.
"""
import argparse
import collections
import datetime
import importlib.util
import json
import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 'ablatrix-source-calibration-2026-10-18-v1'
HELPER_PATH = 'scripts/prepare-flat-source-cohort.py'
HELPER_SHA = '3e8d627d143900e661c17c53c67bf65743f8587afef695a9c517e0032f7eb4d9'
spec = importlib.util.spec_from_file_location('source_calibration_previous', ROOT / HELPER_PATH)
flat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flat)
legacy = flat.legacy
STRATA = tuple(legacy.STRATA)
FROZEN_CANDIDATE = {
    'format': 'ablatrix-source-calibration-candidate-freeze-v1',
    'frozen': True,
    'contract': 'workspace-answer-source-calibration-v2',
    'tool': 'workspace_answer_source_calibration_v2',
    'systemInstructionsSha256': 'e9faddec60d475fe358b01e6c7464eb2993848e982a764f7c12b122266d148f8',
    'baseCommit': '804cb94d12f19ca8066bacb064f08b0f97bc9086',
    'target': 'source interpretation and calibration',
    'selectionSeed': SEED,
    'status': 'experimental_not_promoted',
    'qualityClaimEligible': False,
}
# Preserve the existing firearm, physical-intent, appearance/performance and
# compatibility rules, with an explicit conservative consumer-demo boundary.
HIGH_STAKES = re.compile(
    r'\b(?:safe|safety|safely|hazard\w*|toxic\w*|poison\w*|allerg\w*|'
    r'medic\w*|health\w*|diagnos\w*|treat(?:ment|ing)?|therap\w*|surg\w*|'
    r'prescri\w*|dose|dosage|insulin|glucose|blood|pain|symptoms?|pregnan\w*|'
    r'cpap|pacemaker|defibrillator|car seats?|helmets?|respirators?|'
    r'fall protection|safety harness|life jackets?|fire extinguishers?|'
    r'flamm\w*|fireproof|fire[- ]resistan\w*|load[- ]bearing|'
    r'electric\w*|volts?|voltage|amps?|amperage|watts?|wattage|'
    r'power suppl\w*|mains|circuit breakers?|outlets?|wiring|'
    r'batter(?:y|ies)|charg(?:e|er|ers|ing)|lithium|'
    r'pressur\w*|(?:\d+(?:\.\d+)?\s*)?(?:psi|psig|psia)|compressed[- ](?:air|gas)|pressure[- ]vessels?|'
    r'legal\w*|laws?|regulat\w*|compliance|certif\w*)\b', re.I)
FAMILY_BRANDS = frozenset({'whirlpool', 'amana', 'maytag', 'kenmore', 'kitchenaid'})
FAMILY_BRAND_PATTERN = re.compile(r'\b(?:whirlpool|amana|maytag|kenmore|kitchen\s*aid)\b')
ELIGIBILITY_AMENDMENT = {
    'revision': 3,
    'reason': 'Before generation, exclude pressure and pressurized-vessel contexts, include KitchenAid in the explicit source-established appliance-brand alias vocabulary, protect every reviewed draft source packet, and inventory both current and canonical sibling project stores.',
    'sourceEstablishedApplianceBrandVocabulary': sorted(FAMILY_BRANDS),
    'corporateRelationshipAssumptions': False,
    'unrelatedMountCompatibilityCreatesAlias': False,
    'selectionSeedAndStrataUnchanged': True,
    'candidateInstructionsUnchanged': True,
    'generationOutputsInspected': False,
    'priorDraftProductsRemainEligible': False,
}


def verify_helpers():
    if legacy.sha((ROOT / HELPER_PATH).read_bytes()) != HELPER_SHA:
        raise ValueError('Immutable flat-source helper changed.')
    flat.verify_helpers()


def candidate_freeze(path):
    raw = pathlib.Path(path).read_bytes()
    document = json.loads(raw)
    if (set(document) != set(FROZEN_CANDIDATE) | {'createdAt'} or
            any(document.get(key) != value for key, value in FROZEN_CANDIDATE.items()) or
            document.get('frozen') is not True):
        raise ValueError('Candidate freeze differs from the fixed source-calibration contract.')
    try:
        timestamp = datetime.datetime.fromisoformat(document['createdAt'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError('Timestamp must include its timezone.')
    except (AttributeError, TypeError, ValueError):
        raise ValueError('Candidate freeze requires an ISO timestamp with timezone.') from None
    return {'fileSha256': legacy.sha(raw), 'document': document}


def source_only_rows(rows):
    """Even fixture callers cannot pass label/answer/outcome columns onward."""
    return [{**{key: row[key] for key in flat.ALLOWED_COLUMNS}, 'row': row['row']}
            for row in rows]


def source_packet_fingerprint(source):
    # Labels, source IDs and product IDs cannot conceal a reused source packet.
    return legacy.sha(legacy.compact([legacy.normalized(source['text']),
                                     legacy.normalized(source.get('originalQuestion') or '')]))


def prior_cohort(path):
    raw = pathlib.Path(path).read_bytes()
    document = json.loads(raw)
    if (document.get('format') != 'ablatrix-source-calibration-cohort-v1' or
            document.get('cohortSha256') != flat.checksum(document, 'cohortSha256') or
            document.get('status', {}).get('generationPerformed') is not False or
            len(document.get('cases', [])) != 8):
        raise ValueError('Prior cohort must be an intact eight-case source-only preparation.')
    cases = []
    for case in document['cases']:
        product = case['product']
        if not flat.ASIN.fullmatch(product['id']) or not product['title'].strip():
            raise ValueError('Prior cohort product identity is invalid.')
        sources = [{key: source.get(key) for key in
                    ('id', 'label', 'text', 'originalQuestion', 'reference', 'sha256')}
                   for source in case['sources']]
        for source in sources:
            values = [source['id'], source['label'], source['text'],
                      source['originalQuestion'], source['reference']]
            if (not isinstance(source['text'], str) or not source['text'] or
                    source['sha256'] != legacy.sha(json.dumps(
                        values, ensure_ascii=False, separators=(',', ':')))):
                raise ValueError('Prior cohort source binding is invalid.')
        if case['sourcePoolSha256'] != legacy.sha(legacy.compact(case['sources'])):
            raise ValueError('Prior cohort source pool binding is invalid.')
        cases.append({'id': product['id'], 'title': product['title'],
                      'question': case['question'], 'sources': sources})
    if len({case['id'].upper() for case in cases}) != 8:
        raise ValueError('Prior cohort products must be distinct.')
    projection = {
        'fileSha256': legacy.sha(raw), 'cohortSha256': document['cohortSha256'],
        'productIds': sorted(case['id'].upper() for case in cases),
        'canonicalFamilyTitles': sorted({flat.previous.title_family(case['title']) for case in cases}),
        'modelIdentifiers': sorted(set().union(*(flat.source_identifiers(case) for case in cases))),
        'sourcePacketFingerprints': sorted({source_packet_fingerprint(source)
                                            for case in cases for source in case['sources']}),
    }
    return {'projection': projection, 'cases': cases}


def prior_source_reviews(paths, prior_projection):
    expected_cohorts = {item['fileSha256'] for item in prior_projection}
    result = []
    for path in paths:
        raw = pathlib.Path(path).read_bytes()
        review = json.loads(raw)
        if (review.get('status') != 'failed' or
                review.get('provenance') != 'independent_ai_source_and_family_review' or
                review.get('cohortFileSha256') not in expected_cohorts):
            raise ValueError('Prior source review must record independent rejection of an explicitly protected prior cohort.')
        result.append({'fileSha256': legacy.sha(raw), 'status': review['status'],
                       'cohortFileSha256': review['cohortFileSha256'],
                       'provenance': review['provenance']})
    if len({item['fileSha256'] for item in result}) != len(result):
        raise ValueError('Prior source reviews must be distinct.')
    reviewed_cohorts = {item['cohortFileSha256'] for item in result}
    if reviewed_cohorts != expected_cohorts or len(result) != len(expected_cohorts):
        raise ValueError('Prior source reviews must cover every prior cohort exactly once.')
    return result


def source_family_brands(rows, metadata):
    """Source-established aliases only, with no corporate-ownership assumptions."""
    flat.set_brands(rows, metadata)
    entries = [(row['title'], row['title'] + ' ' + row['question'] + ' ' + row['candidate'])
               for row in rows]
    entries += [(item.get('title', ''), item.get('title', '') + ' ' + item.get('question', ''))
                for item in metadata]
    entries += [(item.get('title', ''), item.get('title', '') + ' ' + item.get('question', '') + ' ' +
                 source.get('text', '') + ' ' + (source.get('originalQuestion') or ''))
                for item in metadata for source in item.get('sources', [])]
    aliases = {brand: {brand} for brand in FAMILY_BRANDS}
    seen = []
    for title, text in entries:
        brands = {re.sub(r'\s+', '', brand) for brand in
                  FAMILY_BRAND_PATTERN.findall(legacy.normalized(text))}
        seen.append((title, brands))
        for brand in brands:
            aliases[brand] |= brands
    changed = True
    while changed:
        changed = False
        for brand, values in aliases.items():
            expanded = set().union(*(aliases[value] for value in values))
            if not expanded <= values:
                aliases[brand] |= expanded
                changed = True
    for title, brands in seen:
        for brand in brands:
            flat.previous.SOURCE_BRANDS.setdefault(legacy.normalized(title), set()).update(aliases[brand])


def select(rows, audit, prior_cohorts=()):
    rows = sorted(source_only_rows(rows), key=lambda row: (
        row['ASIN'], row['row'], row['qid'], row['source'], row['candidate']))
    by_product, questions = collections.defaultdict(list), {}
    inconsistent_questions = set()
    for row in rows:
        by_product[row['ASIN']].append(row)
        prior = questions.setdefault(row['qid'], row)
        if any(prior[key] != row[key] for key in ('ASIN', 'title', 'question')):
            inconsistent_questions.add(row['qid'])
    prior_cases = [case for prior in prior_cohorts for case in prior['cases']]
    protected = {item['id'].upper() for item in audit['protectedProducts']} | {case['id'].upper() for case in prior_cases}
    protected_titles = sorted({item['title'] for item in audit['protectedProducts']
                               if item['title']} | set(audit['extraTitles']) | {case['title'] for case in prior_cases})
    protected_ids = set(audit['protectedTargetIdentifiers']) | set().union(
        *(flat.source_identifiers(case) for case in prior_cases))
    protected_packets = {source_packet_fingerprint(source) for case in prior_cases for source in case['sources']}
    metadata = flat.metadata_items(audit['metadata']) + prior_cases + [
        {'title': title, 'sources': []} for title in protected_titles]
    source_family_brands(rows, metadata)
    protected_snapshots = set()
    for pid in protected:
        if pid in by_product:
            try:
                protected_snapshots.add(flat.snapshot_fingerprint(by_product[pid]))
            except ValueError:
                pass  # Exact product, family and full raw identifier exclusions remain.
    pools, identifiers, fingerprints = {}, {}, {}
    eligible = collections.defaultdict(list)
    decisions = []

    def reject(stage, reason, **fields):
        decisions.append({'stage': stage, 'eligible': False, 'reason': reason, **fields})

    for pid, product_rows in sorted(by_product.items()):
        title = product_rows[0]['title'].strip()
        reason = None
        if pid.upper() in protected:
            reason = 'previously_exposed_or_reserved'
        elif not flat.ASIN.fullmatch(pid) or not 3 <= len(title) <= 160 or any(
                row['title'].strip() != title for row in product_rows):
            reason = 'unsupported_product_or_title'
        elif flat.DOMAIN.search(title) or HIGH_STAKES.search(title):
            reason = 'outside_consumer_demo_domain'
        elif any(flat.DOMAIN.search(row['candidate']) or HIGH_STAKES.search(row['candidate'])
                 for row in product_rows):
            reason = 'outside_consumer_demo_source_scope'
        elif any(flat.previous.family_conflict(title, other) for other in protected_titles):
            reason = 'protected_brand_family_or_near_title'
        ids = set().union(*(flat.previous.model_ids(
            row['title'] + ' ' + row['question'] + ' ' + row['candidate'])
                           for row in product_rows))
        if not reason and legacy.identifier_conflict(ids, protected_ids):
            reason = 'protected_full_source_identifier_or_near_model'
        if reason:
            reject('product', reason, productId=pid)
            continue
        try:
            if any(len(legacy.split_context(row)[0]) > 1500 for row in product_rows):
                raise ValueError('full_source_parent_exceeds_1500')
            fingerprint = flat.snapshot_fingerprint(product_rows)
            if fingerprint in protected_snapshots:
                raise ValueError('protected_identical_source_pool')
            pools[pid] = legacy.pool(product_rows)
            if any(source_packet_fingerprint(source) in protected_packets for source in pools[pid][0]):
                del pools[pid]
                raise ValueError('protected_prior_source_packet')
            identifiers[pid], fingerprints[pid] = ids, fingerprint
        except ValueError as error:
            reject('product', str(error), productId=pid)
    for qid, row in sorted(questions.items()):
        pid = row['ASIN']
        if pid not in pools:
            continue
        if qid in inconsistent_questions:
            reject('question', 'inconsistent_question_identity', qid=qid, productId=pid)
            continue
        if (not re.fullmatch(r'[A-Za-z0-9_-]{1,90}', qid) or
                not 8 <= len(row['question'].strip()) <= 300):
            reject('question', 'unsupported_question_bound', qid=qid, productId=pid)
            continue
        if flat.DOMAIN.search(row['question']) or HIGH_STAKES.search(row['question']):
            reject('question', 'outside_consumer_demo_question_scope', qid=qid, productId=pid)
            continue
        strata = flat.strata_for(row['question'], pools[pid][0])
        if not strata:
            reject('question', 'outside_frozen_strata', qid=qid, productId=pid)
        for stratum in sorted(strata):
            eligible[stratum].append((legacy.sha(f'{SEED}:{stratum}:{qid}'), row))
    selected, selected_ids, selected_titles, selected_identifiers, selected_fingerprints = [], set(), [], set(), set()
    for stratum, count in STRATA:
        found = 0
        for rank, row in sorted(eligible[stratum], key=lambda entry: entry[0]):
            pid, title = row['ASIN'], row['title'].strip()
            reason = ('selected_product_overlap' if pid in selected_ids else
                      'selected_source_pool_overlap' if fingerprints[pid] in selected_fingerprints else
                      'selected_full_source_model_overlap' if legacy.identifier_conflict(identifiers[pid], selected_identifiers) else
                      'selected_family_overlap' if any(flat.previous.family_conflict(title, other) for other in selected_titles) else None)
            if reason:
                reject('ranked_selection', reason, qid=row['qid'], productId=pid,
                       stratum=stratum, rankSha256=rank)
                continue
            sources, origins = pools[pid]
            selected.append({
                'id': f"source-calibration-train-{row['qid']}", 'stratum': stratum,
                'product': {'id': pid, 'title': title}, 'question': row['question'].strip(),
                'sources': sources, 'sourceOrigins': origins,
                'sourcePoolSha256': legacy.sha(legacy.compact(sources)),
                'sourceSnapshotFingerprint': fingerprints[pid],
                'upstream': {'split': 'train', 'qid': row['qid'], 'questionRow': row['row']},
                'selectionRankSha256': rank,
                'familyAudit': {'status': 'pending_independent_source_and_family_review'},
            })
            decisions.append({'stage': 'ranked_selection', 'eligible': True, 'selected': True,
                              'qid': row['qid'], 'productId': pid, 'stratum': stratum,
                              'rankSha256': rank})
            selected_ids.add(pid)
            selected_titles.append(title)
            selected_identifiers |= identifiers[pid]
            selected_fingerprints.add(fingerprints[pid])
            found += 1
            if found == count:
                break
        if found != count:
            return selected, decisions, inventory(
                rows, by_product, questions, pools, eligible, decisions, False,
                f'Insufficient disjoint cases for {stratum}; no seed, strata or case replacement.')
    return selected, decisions, inventory(rows, by_product, questions, pools, eligible, decisions, True)


def inventory(rows, products, questions, pools, eligible, decisions, passed, stop_reason=None):
    result = {'passed': passed, 'trainRows': len(rows), 'trainProducts': len(products),
              'trainQuestions': len(questions), 'eligibleFullPools': len(pools),
              'eligibleQuestionCounts': {name: len(eligible[name]) for name, _ in STRATA},
              'rejectedCounts': dict(sorted(collections.Counter(
                  decision['reason'] for decision in decisions if not decision['eligible']).items()))}
    if stop_reason:
        result['stopReason'] = stop_reason
    return result


def prepare(args):
    # Validate the immutable candidate before touching a CSV or source inventory.
    freeze = candidate_freeze(args.candidate_freeze)
    verify_helpers()
    destination = pathlib.Path(args.prepare_dir).resolve()
    if destination == ROOT / 'docs' or ROOT / 'docs' in destination.parents:
        raise ValueError('Private preparation only; source/family review precedes publication.')
    if destination.exists():
        raise ValueError('Preparation directory must be new; never overwrite or resume.')
    rows = flat.load_rows(args.train)
    audit = flat.exposure(args, rows)
    priors = [prior_cohort(path) for path in getattr(args, 'prior_cohort', [])]
    if len({prior['projection']['fileSha256'] for prior in priors}) != len(priors):
        raise ValueError('Prior cohort inputs must be distinct.')
    prior_projection = [prior['projection'] for prior in priors]
    review_projection = prior_source_reviews(getattr(args, 'prior_source_review', []), prior_projection)
    inventory_inputs = {
        'workspaceCount': len(args.workspace_db), 'comparisonCount': len(args.comparison_db),
        'canonicalPathSha256': sorted(legacy.sha(str(pathlib.Path(path).resolve()))
                                     for path in args.workspace_db + args.comparison_db),
    }
    cases, decisions, summary = select(rows, audit, priors)
    selection = flat.bind({
        'format': 'ablatrix-source-calibration-selection-audit-v1', 'selectionSeed': SEED,
        'candidateFreezeFileSha256': freeze['fileSha256'],
        'exposureAuditSha256': audit['auditSha256'], 'inventory': summary,
        'eligibilityAmendment': ELIGIBILITY_AMENDMENT,
        'priorCohorts': prior_projection,
        'priorSourceReviews': review_projection,
        'inventoryInputs': inventory_inputs,
        'decisions': decisions, 'selectionCodeSha256': legacy.sha(pathlib.Path(__file__).read_bytes()),
        'immutableHelperSha256': {HELPER_PATH: HELPER_SHA, **flat.HELPERS},
        'generatedAnswersOrJudgmentsRead': False, 'generationPerformed': False,
        'newProviderCalls': 0}, 'selectionAuditSha256')
    destination.mkdir(parents=True, exist_ok=False)
    flat.write_new(destination / 'exposure-audit.json', audit)
    flat.write_new(destination / 'selection-audit.json', selection)
    if not summary['passed']:
        raise ValueError(summary['stopReason'] + ' Private rejection audits retained.')
    cohort = flat.bind({
        'format': 'ablatrix-source-calibration-cohort-v1', 'selectionSeed': SEED,
        'candidateFreeze': freeze,
        'source': {'url': legacy.URL, 'sha256': legacy.TRAIN_SHA, 'commit': legacy.COMMIT,
                   'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False},
        'selection': {
            'method': 'First SHA256-ranked eligible question per fixed stratum after product, full-source, family and exposure exclusions; no model outcomes.',
            'strata': [{'name': name, 'count': count} for name, count in STRATA],
            'selectionCodeSha256': selection['selectionCodeSha256'],
            'immutableHelperSha256': selection['immutableHelperSha256'],
            'labelOrAnswerColumnsUsed': False, 'modelOutputsUsed': False,
            'sourcePool': 'Every source body and separate original customer question for the selected product, exact deduplication then overlapping <=850-character chunks; no clipping or top-k selection.',
            'domain': 'Existing consumer-demo strata with conservative safety, medical, electrical, legal and weapon exclusions.',
            'maximumCompleteSourceParentCharacters': 1500,
            'eligibilityAmendment': ELIGIBILITY_AMENDMENT,
            'priorCohorts': prior_projection,
            'priorSourceReviews': review_projection,
            'inventoryInputs': inventory_inputs,
        },
        'inventory': summary, 'exposureAuditSha256': audit['auditSha256'],
        'selectionAuditSha256': selection['selectionAuditSha256'],
        'status': {'privateCandidateOnly': True, 'cohortFrozen': False, 'retrievalFrozen': False,
                   'independentSourceAndFamilyReview': 'pending', 'generationPerformed': False,
                   'humanJudgments': 0, 'qualityClaimEligible': False, 'paidExecutionAuthorized': False},
        'executionPlan': {'comparison': 'two fresh first answers per source/question case',
                          'caseCount': 8, 'maximumNewAnswerAttempts': 16,
                          'generationSources': 'Freeze hybrid top five parent bodies separately, each <=1500 characters.',
                          'fullReviewSourceLimit': 128, 'fullReviewSourceCharacters': 2000,
                          'webCalls': 0, 'automaticRetries': 0, 'caseReplacement': False,
                          'paidExecutionAuthorized': False},
        'cases': cases}, 'cohortSha256')
    flat.write_new(destination / 'cohort.json', cohort)
    if candidate_freeze(args.candidate_freeze) != freeze:
        raise ValueError('Candidate freeze changed during preparation; artifacts remain unapproved.')
    if [prior_cohort(path)['projection'] for path in getattr(args, 'prior_cohort', [])] != prior_projection:
        raise ValueError('Prior cohort changed during preparation; artifacts remain unapproved.')
    if prior_source_reviews(getattr(args, 'prior_source_review', []), prior_projection) != review_projection:
        raise ValueError('Prior source review changed during preparation; artifacts remain unapproved.')
    verify_helpers()
    return {'cases': len(cases), 'sources': sum(len(case['sources']) for case in cases),
            'protectedProducts': len(audit['protectedProducts']), 'cohortSha256': cohort['cohortSha256'],
            'newProviderCalls': 0, 'paidExecutionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate-freeze', required=True)
    parser.add_argument('--train', required=True)
    parser.add_argument('--prepare-dir', required=True)
    parser.add_argument('--workspace-db', action='append', default=[])
    parser.add_argument('--comparison-db', action='append', default=[])
    parser.add_argument('--exposure-audit')
    parser.add_argument('--prior-cohort', action='append', default=[],
                        help='Protect all products, families, identifiers and source packets from a prior reviewed source-only draft; repeatable.')
    parser.add_argument('--prior-source-review', action='append', default=[],
                        help='Bind the independent rejection of an explicitly protected prior cohort; repeatable.')
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args), indent=2))
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Source-calibration preparation stopped: {error}\n')


if __name__ == '__main__':
    main()
