#!/usr/bin/env python3
"""Prepare private, source-only candidates; no generation, download or DB writes.

Current metadata requires explicit workspace/comparison databases. --exposure-audit
replays that frozen metadata without databases; it is not a new freshness audit.
"""
import argparse
import collections
import csv
import importlib.util
import io
import json
import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 'ablatrix-flat-source-quality-2026-10-11-v1'
HELPERS = {
    'scripts/prepare-correction-cohort.py': 'b4518d71c302090358c6523b89c7774ad7ca1a7e13d44addd766c21ad35a93d1',
    'scripts/prepare-source-id-cohort.py': '67d34d46373a16d3af7b80655f7702ebf68c7afc6c193b4a0de43a1824c3c67a',
}
spec = importlib.util.spec_from_file_location('flat_source_previous_rules', ROOT / 'scripts/prepare-source-id-cohort.py')
previous = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previous)
legacy = previous.legacy
ALLOWED_COLUMNS = ('qid', 'question', 'ASIN', 'candidate', 'source', 'qa_pair_id', 'title')
BASE = 'docs/evidence/source-id-correction-2026-10-10'
FIXED_FILES = [f'{BASE}/exposure-audit.json', f'{BASE}/cohort-preparation-v1.json',
               f'{BASE}/cohort-preparation-v2.json', f'{BASE}/cohort.json',
               f'{BASE}/manual-eligibility-decisions.json']
ASIN = re.compile(r'\bB[0-9A-Z]{9}\b')
CRITIQUE = previous.CRITIQUE
DOMAIN = re.compile(r'\b(?:firearms?|ammunition|handguns?|pistols?|rifles?|shotguns?|tactical|gun mount|weapon)\b', re.I)


def read(path):
    return json.loads(pathlib.Path(path).read_text())


def checksum(document, field):
    return legacy.sha(legacy.compact({key: value for key, value in document.items() if key != field}))


def bind(document, field):
    document[field] = checksum(document, field)
    return document


def verify_helpers():
    for path, expected in HELPERS.items():
        if legacy.sha((ROOT / path).read_bytes()) != expected:
            raise ValueError('Immutable helper changed: ' + path)


def load_rows(path):
    raw = pathlib.Path(path).read_bytes()
    if legacy.sha(raw) != legacy.TRAIN_SHA:
        raise ValueError('Pinned train checksum mismatch; no download or alternative split.')
    return [{**{key: row[key] for key in ALLOWED_COLUMNS}, 'row': index}
            for index, row in enumerate(csv.DictReader(io.StringIO(raw.decode())), 2)]


def set_brands(rows, metadata=()):
    previous.SOURCE_BRANDS.clear()
    entries = [(row['title'], row['candidate']) for row in rows]
    entries += [(item.get('title', ''), source.get('text', '')) for item in metadata for source in item.get('sources', [])]
    for title, text in entries:
        match = re.match(r'^(?:brand|manufacturer):\s*\{\s*value:\s*([^}]+)\}', text.strip(), re.I)
        if match:
            brand = re.sub(r'[^a-z0-9]', '', legacy.normalized(match[1].strip(' \"')))
            if brand and brand not in {'generic', 'unknown', 'unbranded', 'na'}:
                previous.SOURCE_BRANDS.setdefault(legacy.normalized(title), set()).add(brand)


def source_identifiers(item):
    values = previous.model_ids(item.get('title', '') + ' ' + item.get('question', ''))
    for source in item.get('sources', []):
        values |= previous.model_ids(source.get('text', '') + ' ' + (source.get('originalQuestion') or ''))
    return values


def project_sources(raw):
    return [{'id': source.get('id', ''), 'label': source.get('label', source.get('source', '')),
             'text': source.get('text', ''), 'originalQuestion': source.get('originalQuestion'),
             'reference': source.get('reference')} for source in json.loads(raw or '[]')]


def current_metadata(workspaces, comparisons):
    """SQL projections never select answers, judgments, receipts or credentials."""
    result = {'workspaces': [], 'comparisons': []}
    for number, filename in enumerate(workspaces, 1):
        with sqlite3.connect(pathlib.Path(filename).resolve(strict=True).as_uri() + '?mode=ro', uri=True) as db:
            products = [{'id': pid, 'title': title, 'sources': project_sources(sources)}
                        for pid, title, sources in db.execute("SELECT json_extract(document,'$.id'),json_extract(document,'$.title'),json_extract(document,'$.sources') FROM workspace_products ORDER BY id")]
            runs = [{'productId': pid, 'question': question or '', 'title': title or '', 'sources': project_sources(sources)}
                    for pid, question, title, sources in db.execute("SELECT json_extract(document,'$.productId'),json_extract(document,'$.question'),json_extract(document,'$.reviewContext.product.title'),COALESCE(json_extract(document,'$.reviewContext.sources'),json_extract(document,'$.retrieval.passages')) FROM workspace_runs ORDER BY id")]
        result['workspaces'].append({'inventory': f'workspace-{number}', 'products': products, 'runs': runs})
    for number, filename in enumerate(comparisons, 1):
        with sqlite3.connect(pathlib.Path(filename).resolve(strict=True).as_uri() + '?mode=ro', uri=True) as db:
            cases = [{'id': pid, 'title': title, 'question': question, 'sources': project_sources(sources)}
                     for pid, title, question, sources in db.execute("SELECT json_extract(c.value,'$.product.id'),json_extract(c.value,'$.product.title'),json_extract(c.value,'$.question'),json_extract(c.value,'$.sources') FROM context_comparisons,json_each(document,'$.cases') c WHERE json_extract(document,'$.mode')='live' ORDER BY context_comparisons.id,c.key")]
            reserved = [{'id': pid, 'sourceFingerprint': fingerprint} for pid, fingerprint in db.execute("SELECT product_id,fingerprint FROM context_comparison_exposure WHERE mode='live' ORDER BY product_id")]
        if any(item['id'].upper() not in {case['id'].upper() for case in cases} for item in reserved):
            raise ValueError('A comparison exposure has no source metadata; stop.')
        result['comparisons'].append({'inventory': f'comparison-{number}', 'cases': cases, 'reservedProducts': reserved})
    return result


def metadata_items(metadata):
    return [item for inventory in metadata['workspaces'] for item in inventory['products'] + inventory['runs']] + [item for inventory in metadata['comparisons'] for item in inventory['cases']]


def public_projection():
    # Project identifiers only. Generated prose/outcomes do not enter ranking.
    result = []
    for path in sorted((ROOT / 'docs').rglob('*')):
        if path.suffix not in {'.json', '.md'} or path.is_symlink():
            continue
        ids = sorted(set(ASIN.findall(path.read_text())))
        if ids:
            result.append({'path': path.relative_to(ROOT).as_posix(), 'productIds': ids,
                           'identifierProjectionSha256': legacy.sha(legacy.compact(ids))})
    return result


def fixed_inputs():
    return [{'path': name, 'sha256': legacy.sha((ROOT / name).read_bytes())} for name in FIXED_FILES]


def build_exposure(rows, metadata, references):
    prior = read(ROOT / FIXED_FILES[0])
    if checksum(prior, 'auditSha256') != prior.get('auditSha256'):
        raise ValueError('Prior exposure checksum mismatch.')
    products = {item['id']: {**item, 'reasons': ['previous_protected_inventory']} for item in prior['protectedProducts']}
    identifiers = set(prior['protectedTargetIdentifiers'])
    for filename in FIXED_FILES[1:4]:
        for case in read(ROOT / filename)['cases']:
            item = case['product']
            products.setdefault(item['id'], {**item, 'reasons': ['previous_source_preparation_or_planned_case']})
            identifiers |= source_identifiers({**item, 'question': case['question'], 'sources': case['sources']})
    for item in read(ROOT / FIXED_FILES[4])['decisions']:
        products.setdefault(item['productId'], {'id': item['productId'], 'title': '', 'reasons': ['previous_manual_source_review']})
    if len(products) < 82 or 'B00B8Q31UQ' not in products:
        raise ValueError('Expected at least81 prior public products plus the manual rejection.')
    by_id = collections.defaultdict(list)
    by_title = {}
    for row in rows:
        by_id[row['ASIN']].append(row)
        by_title.setdefault(legacy.normalized(row['title']), set()).add(row['ASIN'])
    for reference in references:
        for pid in reference['productIds']:
            products.setdefault(pid, {'id': pid, 'title': '', 'reasons': ['public_evidence_identifier']})
    extra_titles = set()
    for item in metadata_items(metadata):
        identifiers |= source_identifiers(item)
        pid = item.get('id', '').upper()
        matches = {pid} if ASIN.fullmatch(pid) else by_title.get(legacy.normalized(item.get('title', '')), set())
        if item.get('title'):
            extra_titles.add(item['title'])
        for key in matches:
            products.setdefault(key, {'id': key, 'title': item.get('title', ''), 'reasons': ['current_workspace_or_comparison']})
        for key in ASIN.findall(legacy.compact(item)):
            products.setdefault(key, {'id': key, 'title': '', 'reasons': ['current_source_reference']})
    for pid, item in products.items():
        if by_id.get(pid):
            item['title'] = by_id[pid][0]['title'].strip()
            for row in by_id[pid]:
                identifiers |= previous.model_ids(row['title'] + ' ' + row['question'] + ' ' + row['candidate'])
    return bind({'format': 'ablatrix-flat-source-exposure-audit-v1', 'inputFiles': fixed_inputs(),
                 'publicIdentifierProjections': references, 'metadata': metadata,
                 'metadataSha256': legacy.sha(legacy.compact(metadata)),
                 'metadataInventorySha256': {item['inventory']: legacy.sha(legacy.compact(item)) for item in metadata['workspaces'] + metadata['comparisons']},
                 'protectedProducts': [products[key] for key in sorted(products)],
                 'protectedTargetIdentifiers': sorted(identifiers), 'extraTitles': sorted(extra_titles),
                 'metadataOnly': True, 'generatedAnswersOrJudgmentsRead': False,
                 'newProviderCalls': 0, 'paidExecutionAuthorized': False}, 'auditSha256')


def exposure(args, rows):
    if args.exposure_audit:
        if args.workspace_db or args.comparison_db:
            raise ValueError('Use frozen metadata replay or current databases, not both.')
        audit = read(args.exposure_audit)
        if checksum(audit, 'auditSha256') != audit.get('auditSha256'):
            raise ValueError('Exposure replay checksum mismatch.')
        # Rebuild protection from the recorded metadata and original public
        # projections. Later publications do not rewrite a historical replay.
        for reference in audit['publicIdentifierProjections']:
            name = pathlib.PurePosixPath(reference['path'])
            if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != 'docs':
                raise ValueError('Invalid public projection path.')
            ids = sorted(set(ASIN.findall((ROOT / name).read_text())))
            if ids != reference['productIds'] or legacy.sha(legacy.compact(ids)) != reference['identifierProjectionSha256']:
                raise ValueError('Recorded public identifier projection changed.')
        expected = build_exposure(rows, audit['metadata'], audit['publicIdentifierProjections'])
        if expected != audit:
            raise ValueError('Exposure replay cannot remove or change protected metadata.')
        return audit
    if not args.workspace_db or not args.comparison_db:
        raise ValueError('Explicit current workspace/comparison inventories are required.')
    return build_exposure(rows, current_metadata(args.workspace_db, args.comparison_db), public_projection())


def snapshot_fingerprint(rows):
    values = set()
    for row in rows:
        body, question = legacy.split_context(row)
        values.add((row['source'], legacy.normalized(body), legacy.normalized(question or '')))
    return legacy.sha(legacy.compact(sorted(values)))


def physical_quantity_intent(question):
    text = legacy.normalized(question)
    if re.search(r'\b(?:amps?|amperage|volts?|voltage|watts?|wattage|electrical?|draw)\b|\bcurrent\s+draw\b', text):
        return False
    if re.search(r'\b(?:liters?|litres?|gallons?|cups?|quarts?)\s*(?:per|/)\s*(?:second|minute|hour)', text):
        return False
    return bool(re.search(r'\b(?:dimensions?|length|width|height|depth|diameter|wide|long|tall|deep|size|weight|weigh|capacity|volume|storage|store|stores|hold|holds|holding|carry|carries|carrying|load|liters?|litres?|gallons?|cups?|quarts?|ounces?|pounds?|lbs?|kilograms?|kg|cm|mm|inches|inch|feet|foot)\b', text))


def strata_for(question, sources):
    found = previous.strata_for(question, sources)
    if not physical_quantity_intent(question):
        found.discard('capacity_dimensions')
    return found


def select(rows, audit):
    by_product, questions = collections.defaultdict(list), {}
    for row in rows:
        by_product[row['ASIN']].append(row)
        questions.setdefault(row['qid'], row)
    protected = {item['id'] for item in audit['protectedProducts']}
    titles = sorted({item['title'] for item in audit['protectedProducts'] if item['title']} | set(audit['extraTitles']))
    protected_ids = set(audit['protectedTargetIdentifiers'])
    set_brands(rows, metadata_items(audit['metadata']))
    protected_snapshots = set()
    for pid in protected:
        if pid in by_product:
            try:
                protected_snapshots.add(snapshot_fingerprint(by_product[pid]))
            except ValueError:
                pass  # Exact ASIN, family and complete raw identifier protection still apply.
    pools, identifiers, fingerprints, eligible = {}, {}, {}, collections.defaultdict(list)
    decisions = []

    def reject(stage, reason, **fields):
        decisions.append({'stage': stage, 'eligible': False, 'reason': reason, **fields})

    for pid, product_rows in sorted(by_product.items()):
        title = product_rows[0]['title'].strip()
        reason = None
        if pid in protected:
            reason = 'previously_exposed_or_reserved'
        elif not 3 <= len(title) <= 160 or any(row['title'].strip() != title for row in product_rows):
            reason = 'unsupported_title'
        elif DOMAIN.search(title):
            reason = 'outside_consumer_demo_domain'
        elif any(previous.family_conflict(title, other) for other in titles):
            reason = 'protected_brand_family_or_near_title'
        ids = set().union(*(previous.model_ids(row['title'] + ' ' + row['question'] + ' ' + row['candidate']) for row in product_rows))
        if not reason and legacy.identifier_conflict(ids, protected_ids):
            reason = 'protected_full_source_identifier_or_near_model'
        if reason:
            reject('product', reason, productId=pid)
            continue
        try:
            fingerprint = snapshot_fingerprint(product_rows)
            if fingerprint in protected_snapshots:
                raise ValueError('protected_identical_source_pool')
            pools[pid] = legacy.pool(product_rows)
            fingerprints[pid] = fingerprint
            identifiers[pid] = ids
        except ValueError as error:
            reject('product', str(error), productId=pid)
    for qid, row in sorted(questions.items()):
        pid = row['ASIN']
        if pid not in pools:
            continue  # The explicit product rejection covers all its questions.
        if not 8 <= len(row['question'].strip()) <= 300:
            reject('question', 'unsupported_question_bound', qid=qid, productId=pid)
            continue
        prior_strata = previous.strata_for(row['question'], pools[pid][0])
        strata = strata_for(row['question'], pools[pid][0])
        if 'capacity_dimensions' in prior_strata and 'capacity_dimensions' not in strata:
            reject('question_stratum', 'outside_physical_capacity_or_dimensions_intent', qid=qid, productId=pid, stratum='capacity_dimensions')
        if not strata:
            reject('question', 'outside_frozen_strata', qid=qid, productId=pid)
        for stratum in sorted(strata):
            eligible[stratum].append((legacy.sha(f'{SEED}:{stratum}:{qid}'), row))
    selected, selected_ids, selected_titles, selected_identifiers, selected_fingerprints = [], set(), [], set(), set()
    for stratum, count in legacy.STRATA:
        found = 0
        for rank, row in sorted(eligible[stratum], key=lambda entry: entry[0]):
            pid, title = row['ASIN'], row['title'].strip()
            reason = 'selected_product_overlap' if pid in selected_ids else 'selected_source_pool_overlap' if fingerprints[pid] in selected_fingerprints else 'selected_full_source_model_overlap' if legacy.identifier_conflict(identifiers[pid], selected_identifiers) else 'selected_family_overlap' if any(previous.family_conflict(title, other) for other in selected_titles) else None
            if reason:
                reject('ranked_selection', reason, qid=row['qid'], productId=pid, stratum=stratum, rankSha256=rank)
                continue
            sources, origins = pools[pid]
            selected.append({'id': f"flat-source-train-{row['qid']}", 'stratum': stratum,
                             'product': {'id': pid, 'title': title}, 'question': row['question'].strip(),
                             'sources': sources, 'sourceOrigins': origins, 'sourcePoolSha256': legacy.sha(legacy.compact(sources)),
                             'critique': {'kind': 'ai_assisted', 'text': CRITIQUE}, 'issue': 'answer_quality',
                             'upstream': {'split': 'train', 'qid': row['qid'], 'questionRow': row['row']},
                             'selectionRankSha256': rank, 'familyAudit': {'manualAuditStatus': 'pending_before_dispatch'}})
            decisions.append({'stage': 'ranked_selection', 'eligible': True, 'selected': True, 'qid': row['qid'], 'productId': pid, 'stratum': stratum, 'rankSha256': rank})
            selected_ids.add(pid)
            selected_titles.append(title)
            selected_identifiers |= identifiers[pid]
            selected_fingerprints.add(fingerprints[pid])
            found += 1
            if found == count:
                break
        if found != count:
            return selected, decisions, {'passed': False, 'stopReason': f'Insufficient disjoint cases for {stratum}; no seed or strata replacement.'}
    return selected, decisions, {'passed': True, 'trainProducts': len(by_product), 'trainQuestions': len(questions), 'eligibleFullPools': len(pools), 'eligibleQuestionCounts': {name: len(eligible[name]) for name, _ in legacy.STRATA}}


def write_new(path, value):
    with path.open('x') as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def prepare(args):
    verify_helpers()
    destination = pathlib.Path(args.prepare_dir).resolve()
    if destination == ROOT / 'docs' or ROOT / 'docs' in destination.parents:
        raise ValueError('Private preparation only; public freeze requires separate source/family audit.')
    if destination.exists():
        raise ValueError('Preparation directory must be new; never overwrite or resume.')
    rows = load_rows(args.train)
    audit = exposure(args, rows)
    cases, decisions, inventory = select(rows, audit)
    selection_audit = bind({'format': 'ablatrix-flat-source-selection-audit-v1', 'selectionSeed': SEED,
                            'exposureAuditSha256': audit['auditSha256'], 'inventory': inventory,
                            'decisions': decisions, 'generationPerformed': False, 'newProviderCalls': 0}, 'selectionAuditSha256')
    destination.mkdir(parents=True, exist_ok=False)
    write_new(destination / 'exposure-audit.json', audit)
    write_new(destination / 'selection-audit.json', selection_audit)
    if not inventory['passed']:
        raise ValueError(inventory['stopReason'] + ' Audits retained in the private output directory.')
    cohort = {'format': 'ablatrix-flat-source-correction-cohort-v1', 'preparationRevision': 3, 'selectionSeed': SEED,
              'source': {'url': legacy.URL, 'sha256': legacy.TRAIN_SHA, 'commit': legacy.COMMIT, 'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False},
              'selection': {'method': 'First SHA256-ranked eligible question per fixed stratum, with full-source family and exposure exclusions before any generation.',
                            'strata': [{'name': name, 'count': count} for name, count in legacy.STRATA],
                            'selectionCodeSha256': legacy.sha(pathlib.Path(__file__).read_bytes()), 'helperCodeSha256': HELPERS,
                            'labelOrAnswerColumnsUsed': False, 'modelOutputsUsed': False,
                            'prospectiveAmendment': 'Revision3: require explicit physical size, dimension, volume or storage/load-capacity intent; generic how-many language alone and electrical draw are excluded. Earlier private source-only drafts remain eligible in this preparation because no model output existed; seed, strata and limits are unchanged.',
                            'sourcePool': 'All candidate bodies and separate original CQA questions for a product; exact deduplication and <=850-character overlapping chunks; no silent clipping.'},
              'inventory': inventory, 'exposureAuditSha256': audit['auditSha256'], 'selectionAuditSha256': selection_audit['selectionAuditSha256'],
              'status': {'privateCandidateOnly': True, 'cohortFrozen': False, 'retrievalFrozen': False, 'manualFamilyAuditComplete': False, 'sourceSufficiencyAuditComplete': False, 'generationPerformed': False, 'humanJudgments': 0, 'qualityClaimEligible': False, 'paidExecutionAuthorized': False},
              'executionPlan': {'citationInterface': 'source_ids_v3', 'freshOriginals': 8, 'revisionArmsPerOriginal': 2, 'maximumNewAttempts': 24,
                                'initialLedgerAttempts': 86, 'proposedAbsoluteCallLimit': 110, 'proposedCapUsd': 12, 'previousCapUsd': 10,
                                'planningAllowanceUsd': 2.4, 'priorSpendUsd': 0.200281, 'proposedCumulativePlanningTotalUsd': 11.200281,
                                'generationSourceLimit': 8, 'generationBodyCharacterLimit': 12000, 'reviewerSourceLimit': 128,
                                'webCalls': 0, 'automaticRetries': 0, 'caseReplacement': False, 'paidExecutionAuthorized': False,
                                'authorizationNote': 'Proposed only. New bounded round and revised limits need explicit approval; unused prior allowance is not permission.'}, 'cases': cases}
    bind(cohort, 'cohortSha256')
    write_new(destination / 'cohort.json', cohort)
    verify_helpers()
    return {'cases': len(cases), 'sources': sum(len(c['sources']) for c in cases), 'protectedProducts': len(audit['protectedProducts']),
            'cohortSha256': cohort['cohortSha256'], 'newProviderCalls': 0, 'paidExecutionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--train', required=True)
    parser.add_argument('--prepare-dir', required=True)
    parser.add_argument('--workspace-db', action='append', default=[])
    parser.add_argument('--comparison-db', action='append', default=[])
    parser.add_argument('--exposure-audit')
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args), indent=2))
    except (ValueError, KeyError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Flat-source preparation stopped: {error}\n')


if __name__ == '__main__':
    main()
