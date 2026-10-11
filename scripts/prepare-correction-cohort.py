#!/usr/bin/env python3
"""Prepare a bounded, label-blind ePQA correction cohort; never execute a model.

Inventory is the default. --out explicitly freezes a new file after the development
gate. Retrieval must subsequently be frozen by the existing offline hybrid retriever.
Only the pinned train file is read; no download, environment, provider, or DB write.
"""
import argparse
import collections
import csv
import functools
import hashlib
import io
import json
import pathlib
import re
import sqlite3
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMMIT = 'cec976cc2f2218aa76e562ecc9c7d79f1f3271bc'
TRAIN_SHA = 'b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25'
URL = f'https://raw.githubusercontent.com/amazon-science/contextual-product-qa/{COMMIT}/ePQA/train.csv'
SEED = 'ablatrix-correction-policy-2026-10-10-v1'
PREPARATION_REVISION = 'v3-prospective-full-source-family-audit'
STRATA = [('capacity_dimensions', 2), ('appearance_material', 2), ('model_scope', 2), ('missing_information', 1), ('preservation_control', 1)]
CRITIQUE = ('Review the existing answer against the supplied source context. Correct unsupported claims or model/question mismatches. '
            'Answer the customer question directly when the listing or an applicable customer report supports it, with clear attribution. '
            'Keep a correct, supported answer substantively unchanged. Preserve uncertainty where the requested relationship or fact is absent; '
            'do not invent a fit result. Use concise natural language, avoid repeated evidence framing or internal status labels, and request '
            'only genuinely missing information. Cite exact source text for material claims.')
STOPWORDS = set('the a an and or for with in of to by on from this that inch inches foot feet pack set black white blue red green brown silver small large new retail packaging'.split())


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


@functools.lru_cache(maxsize=20000)
def family(title):
    # Deliberately conservative brand exclusion; additional title/model checks follow.
    return re.sub(r'[^a-z0-9]', '', title.casefold().split()[0]).split('nutone')[0]


@functools.lru_cache(maxsize=20000)
def model_ids(text):
    values = set()
    for word in re.findall(r'\b[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*\b', text):
        token = re.sub(r'[^a-z0-9]', '', word.casefold())
        if len(token) < 4 or not any(c.isdigit() for c in token):
            continue
        if re.fullmatch(r'\d+(?:inches|inch|in|feet|foot|ft|cm|mm|meters?|metres?|gb|tb|mah|oz|watts?|volts?|amps?|w|v|a|cc|rpm|lbs?|grams?|kilograms?|colors?|packs?|pieces?|speed)', token) or re.fullmatch(r'\d+x\d+', token):
            continue
        if any(c.isalpha() for c in token) or len(token) >= 5:
            values.add(token)
    return values


@functools.lru_cache(maxsize=20000)
def title_tokens(title):
    return {word for word in re.findall(r'[a-z0-9]+', normalized(title)) if len(word) > 2 and word not in STOPWORDS}


def overlap(left, right):
    a, b = title_tokens(left), title_tokens(right)
    return len(a & b) / len(a | b) if a | b else 0


def family_conflict(title, other):
    return (family(title) == family(other) or bool(model_ids(title) & model_ids(other)) or overlap(title, other) >= 0.45)


def identifier_conflict(left, right):
    if left & right:
        return True
    return any(a[:6] == b[:6] or (len(a) == len(b) and sum(x != y for x, y in zip(a, b)) <= 1)
               for a in left if len(a) >= 6 for b in right if len(b) >= 6)


def chunks(text, max_chars=850):
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            boundary = max(text.rfind('\n', start + max_chars // 2, end), text.rfind(' ', start + max_chars // 2, end))
            if boundary > start:
                end = boundary
        yield start, end, text[start:end]
        if end == len(text):
            break
        boundary = text.find(' ', max(start + 1, end - 80), end)
        start = boundary + 1 if boundary >= 0 else end
        while start < len(text) and text[start].isspace():
            start += 1


def split_context(row):
    text = row['candidate'].strip()
    if row['source'] != 'cqa':
        return text, None
    matches = list(re.finditer(r'\s+Question:\s*', text))
    if not matches:
        return text, None
    if len(matches) != 1:
        raise ValueError('ambiguous_cqa_context')
    marker = matches[0]
    body, question = text[:marker.start()].strip(), text[marker.end():].strip()
    if not body or not question or len(question) > 500:
        raise ValueError('unsupported_cqa_context')
    return body, question


def pool(rows):
    sources, origins, seen = [], {}, {}
    for row in rows:
        body, question = split_context(row)
        if not body:
            raise ValueError('empty_source')
        for start, end, text in chunks(body):
            key = (row['source'], text, question)
            if key not in seen:
                digest = sha(compact(list(key)))
                source_id = f"epqa-{row['ASIN']}-{row['source']}-{digest[:16]}"
                reference = f"{URL}#row={row['row']}&qa_pair_id={row['qa_pair_id']}&chars={start}-{end}"
                item = {'id': source_id, 'label': row['source'], 'text': text, 'originalQuestion': question, 'reference': reference}
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', source_id) or re.search(r'(?:^|\s)Question:\s*\S', text, re.I):
                    raise ValueError('unsupported_source_context')
                # Exact counterpart of workspaceReviewSourceHash, including source identity.
                item['sha256'] = sha(json.dumps([source_id, item['label'], text, question, reference], ensure_ascii=False, separators=(',', ':')))
                sources.append(item)
                seen[key] = source_id
                origins[source_id] = []
            origins[seen[key]].append({'row': row['row'], 'qaPairId': row['qa_pair_id'], 'qid': row['qid'], 'bodyStart': start, 'bodyEnd': end, 'rawCandidateSha256': sha(row['candidate'])})
    if not 1 <= len(sources) <= 128:
        raise ValueError('full_pool_exceeds_128')
    if any(len(item['text']) > 2000 or len(item['reference']) > 1000 for item in sources):
        raise ValueError('unsupported_source_bound')
    return sources, origins


def exclusions(workspace_paths, comparison_paths, protected_train_rows, replay_path=None):
    products = {}
    files = []
    protected_targets = set()
    for name in ['data/product-qa/corpus.json', 'data/product-qa/final-corpus.json', 'docs/evidence/paid-qa-batch-2026-09-28/manifest.json']:
        raw = (ROOT / name).read_bytes()
        document = json.loads(raw)
        for item in document.get('products', document.get('cases', [])):
            key = item.get('asin', item.get('id'))
            products[key] = {'id': key, 'title': item['title'], 'reason': 'historical_or_reserved_product'}
            protected_targets.update(model_ids(item['title']))
        for item in document.get('cases', []):
            protected_targets.update(model_ids(item.get('question', '')))
        for item in document.get('passages', []):
            protected_targets.update(model_ids(item['text']))
        files.append({'path': name, 'sha256': sha(raw)})
    for row in protected_train_rows:
        if row['ASIN'] in products:
            protected_targets.update(model_ids(row['candidate']))
            protected_targets.update(model_ids(row['question']))
    historical = len(products)
    if replay_path:
        replay = json.loads(pathlib.Path(replay_path).read_text())
        if 'cohortSha256' in replay and replay['cohortSha256'] != sha(compact({key: value for key, value in replay.items() if key != 'cohortSha256'})):
            raise ValueError('Replayed cohort checksum mismatch.')
        audit = replay.get('exposureAudit', replay)
        if audit.get('inputFiles') != files or audit.get('historicalProductCount') != historical or not protected_targets.issubset(set(audit.get('protectedTargetIdentifiers', []))):
            raise ValueError('Replayed audit does not match the pinned historical exclusion files.')
        replay_products = {item['id']: item for item in audit['protectedProducts']}
        if any(key not in replay_products or replay_products[key]['title'] != item['title'] for key, item in products.items()):
            raise ValueError('Replayed audit cannot remove or rename protected historical products.')
        products = replay_products
        extra_titles = [item['title'] for entry in audit['workspaceInventories'] for item in entry['otherProducts']]
        public_ids = set(audit['additionalPublicAsinReferences'])
        return products, extra_titles, audit, public_ids
    by_title = {normalized(item['title']): item['id'] for item in products.values()}
    workspace_audits, additional_titles = [], []
    for index, name in enumerate(workspace_paths):
        path = pathlib.Path(name).resolve(strict=True)
        connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
        try:
            documents = [json.loads(row[0]) for row in connection.execute('SELECT document FROM workspace_products ORDER BY id')]
            saved_questions = [row[0] for row in connection.execute("SELECT json_extract(document,'$.question') FROM workspace_runs")]
        finally:
            connection.close()
        mapped, unknown = set(), []
        for item in documents:
            protected_targets.update(model_ids(item['title']))
            for source in item.get('sources', []):
                protected_targets.update(model_ids(source.get('text', '') + ' ' + (source.get('originalQuestion') or '')))
            asin = by_title.get(normalized(item['title']))
            if asin:
                mapped.add(asin)
            else:
                unknown.append({'title': item['title'], 'sourceSnapshotSha256': sha(compact(item.get('sources', [])))})
                additional_titles.append(item['title'])
        workspace_targets = set().union(*(model_ids(question or '') for question in saved_questions))
        protected_targets.update(workspace_targets)
        workspace_audits.append({'inventory': f'workspace-{index + 1}', 'productCount': len(documents), 'mappedHistoricalIds': sorted(mapped), 'otherProducts': unknown, 'questionTargetIdentifiers': sorted(workspace_targets), 'productDocumentsSha256': sha(compact(documents))})
    comparison_audits = []
    for index, name in enumerate(comparison_paths):
        path = pathlib.Path(name).resolve(strict=True)
        connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
        try:
            rows = connection.execute("SELECT product_id,fingerprint,comparison_id FROM context_comparison_exposure WHERE mode='live' ORDER BY product_id").fetchall()
            documents = connection.execute("SELECT json_extract(c.value,'$.product.id'),json_extract(c.value,'$.product.title'),json_extract(c.value,'$.question') FROM context_comparisons,json_each(document,'$.cases') c WHERE json_extract(document,'$.mode')='live'").fetchall()
        finally:
            connection.close()
        titles = {row[0].upper(): row[1] for row in documents}
        for _, title, question in documents:
            protected_targets.update(model_ids(title))
            protected_targets.update(model_ids(question))
        for product_id, _, _ in rows:
            products[product_id.upper()] = {'id': product_id.upper(), 'title': titles.get(product_id.upper(), product_id), 'reason': 'prior_live_comparison'}
        comparison_audits.append({'inventory': f'comparison-{index + 1}', 'liveProducts': [{'id': row[0], 'sourceFingerprint': row[1], 'comparisonId': row[2]} for row in rows]})
    # Conservatively reserve other public ASIN references, without reading answer fields.
    public_ids = set()
    for path in (ROOT / 'docs').rglob('*'):
        if path.suffix in ('.json', '.md') and 'correction-policy-2026-10-10' not in path.parts:
            public_ids.update(re.findall(r'\bB[0-9A-Z]{9}\b', path.read_text()))
    return products, additional_titles, {'historicalProductCount': historical, 'protectedProducts': sorted(products.values(), key=lambda item: item['id']), 'protectedTargetIdentifiers': sorted(protected_targets), 'inputFiles': files, 'workspaceInventories': workspace_audits, 'comparisonInventories': comparison_audits, 'additionalPublicAsinReferences': sorted(public_ids - set(products))}, public_ids


def strata_for(question, sources):
    q = normalized(question)
    body = ' '.join(item['text'] for item in sources)
    listing = ' '.join(item['text'] for item in sources if item['label'] in ('attribute', 'bullet', 'description'))
    queried_ids = model_ids(question)
    contexts = [item['originalQuestion'] for item in sources if item['originalQuestion']]
    compatible = bool(re.search(r'\b(?:fit|fits|compatible with|compatibility with|interchangeable with|replace|replacement for|work with|works with|work on|works on|will.{0,50}work)\b', q))
    found = set()
    if not compatible and re.search(r'\b(?:capacity|how many|how much|hold|holds|dimensions|wide|width|long|length|tall|height|size|weight|weigh)\b', q) and re.search(r'\b\d+(?:\.\d+)?\s*(?:inch|inches|feet|foot|cm|mm|liters?|litres?|gallons?|ounces?|pounds?|lbs?|quarts?|pieces?|cups?|pack)\b', listing, re.I):
        found.add('capacity_dimensions')
    if not compatible and re.search(r'\b(?:colou?r|white|black|grey|gray|finish|material|made of)\b', q) and re.search(r'\b(?:colou?r|white|black|grey|gray|finish|material|wood|steel|plastic|cotton|metal)\b', listing, re.I):
        found.add('appearance_material')
    if compatible and queried_ids and any(model_ids(context) - queried_ids for context in contexts):
        found.add('model_scope')
    if compatible and queried_ids and not queried_ids.intersection(model_ids(body)):
        found.add('missing_information')
    if not compatible and re.search(r'\b(?:included|include|come with|comes with|waterproof|battery|batteries|washable|dishwasher|material|made of)\b', q) and listing:
        found.add('preservation_control')
    return found


def prepare(args):
    raw = pathlib.Path(args.train).read_bytes()
    if sha(raw) != TRAIN_SHA:
        raise ValueError('Pinned train checksum mismatch; no download or alternative split is permitted.')
    if args.exposure_audit and (args.workspace_db or args.comparison_db):
        raise ValueError('Use either the frozen exposure audit or current read-only DB inventories, not both.')
    by_product, questions = collections.defaultdict(list), {}
    # Project only these fields. Dataset label/answer columns never enter selection,
    # source text, retrieval, critique, manifests, or generation.
    allowed = ['qid', 'question', 'ASIN', 'candidate', 'source', 'qa_pair_id', 'title']
    for number, original in enumerate(csv.DictReader(io.StringIO(raw.decode())), 2):
        row = {key: original[key] for key in allowed}
        row['row'] = number
        by_product[row['ASIN']].append(row)
        questions.setdefault(row['qid'], row)
    protected, extra_titles, audit, public_ids = exclusions(args.workspace_db, args.comparison_db, [row for rows in by_product.values() for row in rows], args.exposure_audit)
    excluded_ids = set(protected) | public_ids
    excluded_titles = [item['title'] for item in protected.values()] + extra_titles
    protected_identifiers = set(audit['protectedTargetIdentifiers'])
    rejected, pools, eligible = collections.Counter(), {}, collections.defaultdict(list)
    for product_id, rows in by_product.items():
        title = rows[0]['title'].strip()
        if product_id in excluded_ids:
            rejected['previously_exposed_or_reserved'] += 1
            continue
        if not 3 <= len(title) <= 160 or any(row['title'].strip() != title for row in rows):
            rejected['unsupported_title'] += 1
            continue
        if any(family_conflict(title, other) for other in excluded_titles):
            rejected['historical_family_model_or_near_title'] += 1
            continue
        product_identifiers = model_ids(title) | set().union(*(model_ids(row['candidate']) | model_ids(row['question']) for row in rows))
        if identifier_conflict(product_identifiers, protected_identifiers):
            rejected['protected_full_source_identifier_or_near_model_family'] += 1
            continue
        try:
            pools[product_id] = pool(rows)
        except ValueError as error:
            rejected[str(error)] += 1
    for qid, row in questions.items():
        if row['ASIN'] not in pools or not 8 <= len(row['question'].strip()) <= 300:
            continue
        sources, _ = pools[row['ASIN']]
        if model_ids(row['question']) & set(audit['protectedTargetIdentifiers']):
            continue
        for stratum in strata_for(row['question'], sources):
            eligible[stratum].append((sha(f'{SEED}:{stratum}:{qid}'), row))
    inventory = {'trainRows': sum(map(len, by_product.values())), 'trainProducts': len(by_product), 'trainQuestions': len(questions), 'historicalProducts': audit['historicalProductCount'], 'eligibleFullPools': len(pools), 'rejectedProductCounts': dict(sorted(rejected.items())), 'eligibleQuestionCounts': {name: len(eligible[name]) for name, _ in STRATA}, 'workspaceInventories': len(audit['workspaceInventories']), 'comparisonInventories': len(audit['comparisonInventories'])}
    if not args.out:
        return inventory
    if not args.development_gate_passed:
        raise ValueError('--out requires --development-gate-passed; do not freeze fresh cases before development qualifies.')
    if not args.exposure_audit and (not args.workspace_db or not args.comparison_db):
        raise ValueError('Freeze requires explicit read-only workspace and comparison exposure inventories.')
    selected, selected_titles, selected_ids, selected_targets = [], [], set(), set()
    for name, count in STRATA:
        candidates = sorted(eligible[name], key=lambda entry: entry[0])
        for rank, row in candidates:
            targets = model_ids(row['title']) | model_ids(row['question']) | set().union(*(model_ids(source['text']) | model_ids(source['originalQuestion'] or '') for source in pools[row['ASIN']][0]))
            if row['ASIN'] in selected_ids or identifier_conflict(targets, selected_targets) or any(family_conflict(row['title'], other) for other in selected_titles):
                continue
            sources, origins = pools[row['ASIN']]
            closest = max(excluded_titles, key=lambda title: overlap(row['title'], title))
            selected.append({'id': f"correction-train-{row['qid']}", 'stratum': name, 'product': {'id': row['ASIN'], 'title': row['title'].strip()}, 'question': row['question'].strip(), 'sources': sources, 'sourceOrigins': origins, 'sourcePoolSha256': sha(compact(sources)), 'critique': {'text': CRITIQUE, 'kind': 'ai_assisted'}, 'issue': 'answer_quality', 'upstream': {'split': 'train', 'qid': row['qid'], 'questionRow': row['row']}, 'selectionRankSha256': rank, 'familyAudit': {'firstTitleToken': family(row['title']), 'titleModelIdentifiers': sorted(model_ids(row['title'])), 'closestProtectedTitle': closest, 'titleJaccard': overlap(row['title'], closest), 'exactAsinConflict': False, 'familyOrModelConflict': False, 'manualAuditStatus': 'pending_before_dispatch'}})
            selected_titles.append(row['title'])
            selected_ids.add(row['ASIN'])
            selected_targets.update(targets)
            if sum(item['stratum'] == name for item in selected) == count:
                break
        if sum(item['stratum'] == name for item in selected) != count:
            raise ValueError(f'Insufficient disjoint cases for {name}; stop without changing the seed or silently replacing strata.')
    document = {'format': 'ablatrix-correction-cohort-v1', 'preparationRevision': PREPARATION_REVISION, 'selectionSeed': SEED, 'source': {'url': URL, 'sha256': TRAIN_SHA, 'commit': COMMIT, 'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False}, 'selection': {'method': 'First SHA256-ranked eligible train question per frozen stratum; whole-product ASIN/brand/model/near-title exclusions; exclude protected question/title target identifiers and cross-case target overlap; each selected family appears once.', 'strata': [{'name': name, 'count': count} for name, count in STRATA], 'sourcePool': 'Every candidate for the selected product in pinned train, including distractors; deduplicate exact source/body/original-question tuples, then chunk body at <=850 characters with <=80-character overlap.', 'labelOrAnswerColumnsUsed': False, 'modelOutputsUsed': False, 'selectionCodeSha256': sha(pathlib.Path(__file__).read_bytes())}, 'inventory': inventory, 'exposureAudit': audit, 'status': {'cohortFrozen': True, 'retrievalFrozen': False, 'manualFamilyAuditComplete': False, 'generationPerformed': False, 'humanJudgments': 0, 'qualityClaimEligible': False}, 'executionPlan': {'freshOriginals': 8, 'revisionArmsPerOriginal': 2, 'maximumNewAttempts': 24, 'planningAllowanceUsd': 2.4, 'webCalls': 0, 'automaticRetries': 0, 'caseReplacement': False, 'generationSourceLimit': 8, 'retrieval': 'Existing offline hybrid ProductRetriever over the complete pool; freeze ordered selected IDs before any generation. Same selected sources and deterministic critique for both revisions.', 'critiqueRule': 'Identical rubric-only AI-authored critique is frozen before originals and revision arms; never selected or adapted after seeing outputs.', 'review': 'Sixteen independent human source checks remain required; preserved uncertainty and already-good originals are valid outcomes, not failures to generate a gain.'}, 'cases': selected}
    document['cohortSha256'] = sha(compact(document))
    output = pathlib.Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as handle:
        handle.write(json.dumps(document, indent=2, ensure_ascii=False) + '\n')
    return {'cohortSha256': document['cohortSha256'], 'cases': len(selected), 'sources': sum(len(item['sources']) for item in selected), 'inventory': inventory, 'retrievalFrozen': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--train', required=True, help='Existing pinned train.csv; never downloaded by this command.')
    parser.add_argument('--workspace-db', action='append', default=[], help='Existing workspace inventory, opened read-only; repeat for every relevant workspace.')
    parser.add_argument('--comparison-db', action='append', default=[], help='Existing comparison exposure ledger, opened read-only.')
    parser.add_argument('--exposure-audit', help='Replay a frozen cohort/exposure-audit JSON instead of opening local DBs; verify pinned exclusion files.')
    parser.add_argument('--development-gate-passed', action='store_true')
    parser.add_argument('--out', help='New cohort JSON path. Omit for count-only inventory; existing output is never overwritten.')
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args), indent=2))
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Cohort preparation stopped: {error}\n')


if __name__ == '__main__':
    main()
