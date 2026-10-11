#!/usr/bin/env python3
"""Offline source-ID cohort preparation; no provider, credentials, or DB writes.

--prepare-dir writes a private candidate for manual audit. Publication requires a
passed offline qualification and a separately authored source/family audit.
--exposure-audit reproduces preparation using public metadata, without local DBs.
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
import tempfile
import types

ROOT = pathlib.Path(__file__).resolve().parents[1]
LEGACY_PATH = ROOT / 'scripts/prepare-correction-cohort.py'
spec = importlib.util.spec_from_file_location('legacy_cohort', LEGACY_PATH)
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
SEED = 'ablatrix-source-id-correction-2026-10-10-v1'
OLD = 'docs/evidence/correction-policy-2026-10-10'
INPUT_FILES = ['data/product-qa/corpus.json', 'data/product-qa/final-corpus.json',
               'docs/evidence/paid-qa-batch-2026-09-28/manifest.json',
               f'{OLD}/cohort.json', f'{OLD}/cohort-v2.json', f'{OLD}/cohort-v3.json']
PREPARATION_RECORDS = ['docs/evidence/source-id-correction-2026-10-10/cohort-preparation-v1.json',
                       'docs/evidence/source-id-correction-2026-10-10/failed-coverage-audit-v1.json',
                       'docs/evidence/source-id-correction-2026-10-10/cohort-preparation-v2.json',
                       'docs/evidence/source-id-correction-2026-10-10/failed-coverage-audit-v2.json',
                       'docs/evidence/source-id-correction-2026-10-10/manual-eligibility-decisions.json']
CRITIQUE = legacy.CRITIQUE.replace('Cite exact source text for material claims.',
    'For each material claim, select a supplied source ID that directly supports it. Do not copy or rewrite quote text.')
LEGACY_MODEL_IDS = legacy.model_ids
LEGACY_STRATA_FOR = legacy.strata_for
LEGACY_FAMILY_CONFLICT = legacy.family_conflict
SOURCE_BRANDS = {}
OUT_OF_SCOPE_PRODUCTS = set()


def title_family(title):
    return re.sub(r'^(?:(?:genuine|oem|original|authentic|official|new)\s+)+', '', legacy.normalized(title))


def family_conflict(title, other):
    a, b = title_family(title), title_family(other)
    brands_a = SOURCE_BRANDS.get(legacy.normalized(title), set()) | {legacy.family(a)}
    brands_b = SOURCE_BRANDS.get(legacy.normalized(other), set()) | {legacy.family(b)}
    return bool(brands_a & brands_b) or LEGACY_FAMILY_CONFLICT(a, b)


def model_ids(text):
    # Prospective repair: sizes/units are not explicit device or part identifiers.
    return {token for token in LEGACY_MODEL_IDS(text) if not re.fullmatch(
        r'\d+(?:gal(?:lons?)?|g|oz|qt|pint|l|ml|cl|dl|yd|yards?|in|inch(?:es)?|ft|feet|cm|mm|xh|gbs|mbps|gbps)', token)}


def strata_for(question, sources):
    if any(source['id'].split('-')[1] in OUT_OF_SCOPE_PRODUCTS for source in sources):
        return set()
    found = LEGACY_STRATA_FOR(question, sources)
    q = legacy.normalized(question)
    composition = bool(re.search(r'\b(?:made (?:of|from|out of)|material|composition|finish|solid (?:wood|metal)|(?:is|are).{0,40}(?:plastic|metal|steel|aluminum|aluminium|wood|cotton|leather|glass))\b', q))
    direct_color = bool(re.search(r'\b(?:what|which|actual|exact)\b.{0,35}\bcolou?r\b|\bcolou?r\b.{0,25}\b(?:is|are)\b|\b(?:is|are)\b.{0,35}\b(?:white|black|grey|gray|blue|red|brown|silver|green)\b', q))
    availability = bool(re.search(r'\b(?:available|availability|stock|restock|when|order|ordering)\b', q))
    performance = bool(re.search(r'\b(?:bleed|bled|fade|fading|transfer|smell|odor|stain\w*|rust\w*|scratch\w*|durab\w*|resistan\w*|waterproof|weatherproof|heatproof|fireproof|safe|safety|performance|lasts?)\b|\b\w+[- ](?:resistant|proof|safe)\b', q))
    if availability or performance or not (composition or direct_color):
        found.discard('appearance_material')
    # Only genuine named target models/parts qualify; units alone cannot enter.
    queried_ids = model_ids(question)
    explicit_ids = {token for token in queried_ids if any(c.isalpha() for c in token) and any(c.isdigit() for c in token)}
    if re.search(r'\b(?:model|part)\b', q):
        explicit_ids |= queried_ids
    if not explicit_ids:
        found.discard('model_scope')
    return found


# Adapt the immutable legacy algorithm only in this process. Its pool and source
# hashing stay unchanged; this version owns only prospective eligibility rules.
legacy.model_ids = model_ids
legacy.strata_for = strata_for
legacy.family_conflict = family_conflict


def read(path):
    return json.loads(pathlib.Path(path).read_text())


def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as handle:
        handle.write(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def input_metadata():
    return [{'path': name, 'sha256': legacy.sha((ROOT / name).read_bytes())} for name in INPUT_FILES + PREPARATION_RECORDS]


def documents_and_rows(train):
    raw = pathlib.Path(train).read_bytes()
    if legacy.sha(raw) != legacy.TRAIN_SHA:
        raise ValueError('Pinned train checksum mismatch.')
    allowed = ['qid', 'question', 'ASIN', 'candidate', 'source', 'qa_pair_id', 'title']
    rows = [{**{key: row[key] for key in allowed}, 'row': index}
            for index, row in enumerate(csv.DictReader(io.StringIO(raw.decode())), 2)]
    documents = {name: read(ROOT / name) for name in INPUT_FILES}
    if legacy.sha(LEGACY_PATH.read_bytes()) != documents[f'{OLD}/cohort-v3.json']['selection']['selectionCodeSha256']:
        raise ValueError('Legacy preparation code differs from the immutable v3 source freeze.')
    SOURCE_BRANDS.clear()
    OUT_OF_SCOPE_PRODUCTS.clear()
    for row in rows:
        if re.search(r'\b(?:weapon|firearm|ammunition|rifle|pistol|gun|holster|bayonet)\b', row['title'], re.I):
            OUT_OF_SCOPE_PRODUCTS.add(row['ASIN'])
        match = re.match(r'^(?:brand|manufacturer):\s*\{\s*value:\s*([^}]+)\}', row['candidate'].strip(), re.I)
        if match:
            brand = re.sub(r'[^a-z0-9]', '', legacy.normalized(match[1].strip(' \"')))
            if brand and brand not in {'generic', 'unknown', 'unbranded', 'na'}:
                SOURCE_BRANDS.setdefault(legacy.normalized(row['title']), set()).add(brand)
    return documents, rows


def required_exclusions(documents, rows):
    products, identifiers = {}, set()
    for name in INPUT_FILES[:3]:
        document = documents[name]
        for item in document.get('products', document.get('cases', [])):
            product_id = item.get('asin', item.get('id'))
            products[product_id] = {'id': product_id, 'title': item['title'], 'reason': 'historical_or_reserved_product'}
            identifiers.update(legacy.model_ids(item['title']))
        for item in document.get('cases', []):
            identifiers.update(legacy.model_ids(item.get('question', '')))
        for item in document.get('passages', []):
            identifiers.update(legacy.model_ids(item['text']))
    if len(products) != 56:
        raise ValueError('Historical exclusion count changed; review the protocol before selecting.')
    planned = {item['product']['id'] for item in documents[f'{OLD}/cohort-v3.json']['cases']}
    for name in INPUT_FILES[3:]:
        for item in documents[name]['cases']:
            product = item['product']
            reason = 'previous_eight_product_execution_plan' if product['id'] in planned else 'previous_preparation_only_exposure'
            products[product['id']] = {**product, 'reason': reason}
            identifiers.update(legacy.model_ids(product['title'] + ' ' + item['question']))
            for source in item['sources']:
                identifiers.update(legacy.model_ids(source['text'] + ' ' + (source['originalQuestion'] or '')))
    if len(planned) != 8 or len(products) != 67:
        raise ValueError('Expected 56 historical plus8 previously planned plus3 preparation-only products.')
    for row in rows:
        if row['ASIN'] in products:
            identifiers.update(legacy.model_ids(row['title'] + ' ' + row['question'] + ' ' + row['candidate']))
    return products, identifiers


def exposure_audit(args, documents, rows):
    products, identifiers = required_exclusions(documents, rows)
    files = input_metadata()
    if args.exposure_audit:
        if args.workspace_db or args.comparison_db:
            raise ValueError('Use public replay metadata or read-only DB inventories, not both.')
        audit = read(args.exposure_audit)
        expected_hash = audit.pop('auditSha256', None)
        if expected_hash != legacy.sha(legacy.compact(audit)):
            raise ValueError('Exposure audit checksum mismatch.')
        audit['auditSha256'] = expected_hash
        got = {item['id']: item for item in audit['protectedProducts']}
        if audit['inputFiles'] != files or not identifiers.issubset(set(audit['protectedTargetIdentifiers'])) or any(got.get(key) != value for key, value in products.items()):
            raise ValueError('Exposure replay cannot remove or alter protected products, identifiers, or input files.')
        return audit
    if not args.workspace_db or not args.comparison_db:
        raise ValueError('Preparation requires explicit existing workspace/comparison inventories or a frozen exposure audit.')
    workspace, comparisons = [], []
    by_title = {legacy.normalized(item['title']): item['id'] for item in products.values()}
    for index, filename in enumerate(args.workspace_db):
        connection = sqlite3.connect(pathlib.Path(filename).resolve(strict=True).as_uri() + '?mode=ro', uri=True)
        try:
            records = [json.loads(row[0]) for row in connection.execute('SELECT document FROM workspace_products ORDER BY id')]
            questions = [row[0] or '' for row in connection.execute("SELECT json_extract(document,'$.question') FROM workspace_runs")]
        finally:
            connection.close()
        mapped, other, question_ids = set(), [], set()
        for question in questions:
            question_ids.update(legacy.model_ids(question))
        identifiers.update(question_ids)
        for record in records:
            identifiers.update(legacy.model_ids(record['title']))
            for source in record.get('sources', []):
                identifiers.update(legacy.model_ids(source['text'] + ' ' + (source.get('originalQuestion') or '')))
            product_id = by_title.get(legacy.normalized(record['title']))
            if product_id:
                mapped.add(product_id)
            else:
                other.append({'title': record['title'], 'sourceSnapshotSha256': legacy.sha(legacy.compact(record.get('sources', [])))})
        workspace.append({'inventory': f'workspace-{index + 1}', 'productCount': len(records), 'mappedHistoricalIds': sorted(mapped), 'otherProducts': sorted(other, key=lambda item: item['title']), 'questionTargetIdentifiers': sorted(question_ids), 'productDocumentsSha256': legacy.sha(legacy.compact(records))})
    for index, filename in enumerate(args.comparison_db):
        connection = sqlite3.connect(pathlib.Path(filename).resolve(strict=True).as_uri() + '?mode=ro', uri=True)
        try:
            records = connection.execute("SELECT json_extract(c.value,'$.product.id'),json_extract(c.value,'$.product.title'),json_extract(c.value,'$.question'),json_extract(c.value,'$.sources') FROM context_comparisons,json_each(document,'$.cases') c WHERE json_extract(document,'$.mode')='live'").fetchall()
            exposures = connection.execute("SELECT product_id,fingerprint,comparison_id FROM context_comparison_exposure WHERE mode='live' ORDER BY product_id").fetchall()
        finally:
            connection.close()
        for product_id, title, question, source_json in records:
            products.setdefault(product_id.upper(), {'id': product_id.upper(), 'title': title, 'reason': 'previous_live_comparison'})
            identifiers.update(legacy.model_ids(title + ' ' + question))
            for source in json.loads(source_json):
                identifiers.update(legacy.model_ids(source['text'] + ' ' + (source.get('originalQuestion') or '')))
        if any(row[0].upper() not in products for row in exposures):
            raise ValueError('Comparison exposure has no corresponding product/source metadata.')
        comparisons.append({'inventory': f'comparison-{index + 1}', 'liveProducts': [{'id': row[0], 'sourceFingerprint': row[1], 'comparisonId': row[2]} for row in exposures]})
    audit = {'format': 'ablatrix-source-id-exposure-audit-v1', 'historicalProductCount': 56, 'previousPlannedProductCount': 8, 'previousPreparationOnlyProductCount': 3, 'protectedProducts': sorted(products.values(), key=lambda item: item['id']), 'protectedTargetIdentifiers': sorted(identifiers), 'inputFiles': files, 'workspaceInventories': workspace, 'comparisonInventories': comparisons, 'additionalPublicAsinReferences': [], 'outcomeFilesRead': False, 'paidExecutionAuthorized': False, 'notes': ['All8 products from the previous execution plan are excluded, including those never called.', 'Three other products inspected during prior source preparation are separately excluded; they are not counted as generated answers.', 'Only source/question/title metadata are used. No generated answer, relevance label, or test split enters selection.']}
    audit['auditSha256'] = legacy.sha(legacy.compact(audit))
    return audit


def prepare(args):
    documents, rows = documents_and_rows(args.train)
    audit = exposure_audit(args, documents, rows)
    products = {item['id']: item for item in sorted(audit['protectedProducts'], key=lambda item: item['id'])}
    extra_titles = sorted(item['title'] for inventory in audit['workspaceInventories'] for item in inventory['otherProducts'])
    # Explicit in-memory adaptation only; the legacy source file is never edited.
    # Stable product-ID order also fixes the old nearest-title diagnostic tie.
    legacy.exclusions = lambda *_: (products, extra_titles, audit, set(audit['additionalPublicAsinReferences']))
    legacy.SEED = SEED
    legacy.CRITIQUE = CRITIQUE
    legacy.PREPARATION_REVISION = 'source-ids-v3-prospective-coverage-and-brand-repair'
    with tempfile.TemporaryDirectory(prefix='ablatrix-source-cohort-') as temporary:
        output = pathlib.Path(temporary) / 'projection.json'
        inventory = legacy.prepare(types.SimpleNamespace(train=args.train, exposure_audit='public_metadata', workspace_db=[], comparison_db=[], development_gate_passed=True, out=str(output) if args.prepare_dir else None))
        if not args.prepare_dir:
            return inventory
        cohort = read(output)
    destination = pathlib.Path(args.prepare_dir).resolve()
    if destination == ROOT / 'docs' or ROOT / 'docs' in destination.parents:
        raise ValueError('Prepare privately first; --publish-from is required for a qualified public freeze.')
    cohort.pop('cohortSha256')
    cohort['format'] = 'ablatrix-source-id-correction-cohort-v1'
    cohort['selection']['wrapperCodeSha256'] = legacy.sha(pathlib.Path(__file__).read_bytes())
    cohort['selection']['legacyCodeSha256'] = legacy.sha(LEGACY_PATH.read_bytes())
    cohort['selection']['nearestTitleTieOrder'] = 'Protected product IDs sorted lexicographically, then extra workspace titles sorted lexicographically.'
    cohort['selection']['prospectiveAmendment'] = {'revision': 3, 'reason': 'Repair question coverage and family identity before any generation: direct appearance/composition intent, excluding availability/performance; genuine model identifiers exclude size/measurement units; source manufacturer/brand and generic-prefix-normalized title family checks.', 'priorPreparations': PREPARATION_RECORDS, 'seedAndCountsUnchanged': True, 'outputsInspected': False, 'sameRoundSourceOnlyCandidatesRemainEligible': True}
    cohort['selection']['domainEligibility'] = 'Ordinary consumer product QA; title-identified weapon/firearm/ammunition product compatibility or optimization is excluded uniformly. Source-only eligibility decision is separately recorded.'
    cohort['exposureAuditSha256'] = audit['auditSha256']
    cohort['status']['paidExecutionAuthorized'] = False
    cohort['executionPlan'].update({'citationInterface': 'source_ids_v1', 'paidExecutionAuthorized': False, 'initialLedgerAttempts': 73, 'proposedAbsoluteCallLimit': 97, 'previousAuthorizedCallLimit': 93, 'capUsd': 10, 'priorSpendUsd': 0.200281, 'proposedCumulativePlanningTotalUsd': 9.900281, 'authorizationNote': 'A future24-call round needs separate explicit approval. Unused allowance from the stopped round does not authorize dispatch.'})
    for item in cohort['cases']:
        item['id'] = item['id'].replace('correction-train-', 'source-id-train-', 1)
    cohort['cohortSha256'] = legacy.sha(legacy.compact(cohort))
    for name in ['exposure-audit.json', 'cohort.json']:
        if (destination / name).exists():
            raise ValueError('Private preparation output already exists; no overwrite or outcome-driven replacement.')
    write_new(destination / 'exposure-audit.json', audit)
    write_new(destination / 'cohort.json', cohort)
    return {'cohortSha256': cohort['cohortSha256'], 'cases': len(cohort['cases']), 'sources': sum(len(item['sources']) for item in cohort['cases']), 'protectedProducts': len(products), 'paidExecutionAuthorized': False, 'newProviderCalls': 0}


def publish(args):
    if not args.out_dir or not args.qualification or not args.family_audit:
        raise ValueError('Publication requires --out-dir, --qualification, and --family-audit.')
    source = pathlib.Path(args.publish_from)
    cohort, exposure, family, qualification = read(source / 'cohort.json'), read(source / 'exposure-audit.json'), read(args.family_audit), read(args.qualification)
    if qualification.get('passed') is not True or qualification.get('newProviderCalls') != 0 or qualification.get('qualityClaimEligible') is not False or qualification.get('sourceIdInterface') != 'source_ids_v1':
        raise ValueError('Offline citation qualification must pass with no paid calls or quality claim.')
    implementation = qualification.get('implementationSha256', {})
    if not implementation or any(pathlib.PurePosixPath(name).is_absolute() or '..' in pathlib.PurePosixPath(name).parts or legacy.sha((ROOT / name).read_bytes()) != digest for name, digest in implementation.items()):
        raise ValueError('Qualified implementation changed or the qualification has invalid file bindings.')
    if family.get('passed') is not True or family.get('cohortFileSha256') != legacy.sha((source / 'cohort.json').read_bytes()) or sorted(item['id'] for item in family['cases'] if item['passed']) != sorted(item['id'] for item in cohort['cases']):
        raise ValueError('All8 cases require a source/family audit bound to the exact private cohort.')
    if cohort['selection']['wrapperCodeSha256'] != legacy.sha(pathlib.Path(__file__).read_bytes()) or cohort['selection']['legacyCodeSha256'] != legacy.sha(LEGACY_PATH.read_bytes()):
        raise ValueError('Preparation code changed after the candidate freeze.')
    if len(cohort['cases']) != 8 or collections.Counter(item['stratum'] for item in cohort['cases']) != dict(legacy.STRATA) or cohort['selectionSeed'] != SEED or cohort['status']['paidExecutionAuthorized'] is not False or cohort['executionPlan']['maximumNewAttempts'] != 24:
        raise ValueError('Cohort protocol or authorization state changed.')
    for document, key in [(cohort, 'cohortSha256'), (exposure, 'auditSha256')]:
        if document[key] != legacy.sha(legacy.compact({k: v for k, v in document.items() if k != key})):
            raise ValueError('Candidate document checksum mismatch.')
    if cohort['exposureAuditSha256'] != exposure['auditSha256'] or cohort['exposureAudit'] != exposure:
        raise ValueError('Cohort exclusion audit differs from the publication audit.')
    target = pathlib.Path(args.out_dir)
    copies = [(source / 'exposure-audit.json', target / 'exposure-audit.json'), (source / 'cohort.json', target / 'cohort.json'), (pathlib.Path(args.family_audit), target / 'manual-family-audit.json')]
    if any(dst.exists() for _, dst in copies):
        raise ValueError('Public cohort/audit output exists; never overwrite frozen records.')
    target.mkdir(parents=True, exist_ok=True)
    for src, dst in copies:
        with dst.open('xb') as handle:
            handle.write(src.read_bytes())
    return {'published': True, 'cohortSha256': cohort['cohortSha256'], 'paidExecutionAuthorized': False, 'newProviderCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--train')
    parser.add_argument('--workspace-db', action='append', default=[])
    parser.add_argument('--comparison-db', action='append', default=[])
    parser.add_argument('--exposure-audit')
    parser.add_argument('--prepare-dir')
    parser.add_argument('--publish-from')
    parser.add_argument('--out-dir')
    parser.add_argument('--qualification')
    parser.add_argument('--family-audit')
    args = parser.parse_args()
    if not args.publish_from and not args.train:
        parser.error('--train is required for inventory or preparation.')
    try:
        print(json.dumps(publish(args) if args.publish_from else prepare(args), indent=2))
    except (ValueError, KeyError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Source-ID preparation stopped: {error}\n')


if __name__ == '__main__':
    main()
