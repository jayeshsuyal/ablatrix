#!/usr/bin/env python3
"""Freeze an unseen ePQA product set from pinned train data; never read upstream test."""
import csv
import hashlib
import importlib.util
import io
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
source_spec = importlib.util.spec_from_file_location('epqa_importer', ROOT / 'scripts/import-epqa.py')
source_module = importlib.util.module_from_spec(source_spec)
source_spec.loader.exec_module(source_module)
BASE, COMMIT, SOURCE, SOURCE_HASHES = source_module.BASE, source_module.COMMIT, source_module.SOURCE, source_module.SOURCE_HASHES
chunks, sha = source_module.chunks, source_module.sha
RAW = ROOT / 'work/epqa/train.csv'
OUT = ROOT / 'data/product-qa'
SEED = 'ablatrix-v02-final'

def main():
    source = RAW.read_bytes()
    if sha(source) != SOURCE_HASHES['train']:
        raise ValueError('Pinned source checksum mismatch')
    original = json.loads((OUT / 'corpus.json').read_text())
    used = {product['id'] for product in original['products']}
    rows = list(csv.DictReader(io.StringIO(source.decode())))
    by_question = {}
    for row in rows:
        by_question.setdefault(row['qid'], []).append(row)
    eligible = []
    for qid, items in by_question.items():
        first = items[0]
        question = first['question'].strip()
        if first['ASIN'] in used or len(items) < 4 or not 15 <= len(question) <= 150:
            continue
        if not {'bullet', 'attribute', 'review'}.intersection({item['source'] for item in items}):
            continue
        eligible.append((hashlib.sha256(f'{SEED}:{qid}'.encode()).hexdigest(), qid, first))
    selected = []
    seen_products = set(used)
    seen_families = set()
    for _, qid, first in sorted(eligible):
        asin = first['ASIN']
        family = first['title'].split()[0].casefold().strip('.,-')
        if asin in seen_products or family in seen_families:
            continue
        selected.append((qid, first))
        seen_products.add(asin)
        seen_families.add(family)
        if len(selected) == 20:
            break
    if len(selected) != 20:
        raise ValueError('Insufficient disjoint final products')
    product_ids = {first['ASIN'] for _, first in selected}
    product_by_qid = {qid: first['ASIN'] for qid, first in selected}
    corpus = {'version': f'epqa-final-v1-{COMMIT[:12]}', 'source': SOURCE, 'license': 'CDLA-Sharing-1.0',
              'products': [{'id': first['ASIN'], 'title': first['title'], 'split': 'holdout'} for _, first in selected],
              'passages': [], 'cases': []}
    passage_ids = set()
    origins = {}
    url = f'{BASE}/ePQA/train.csv'
    for row_number, row in enumerate(rows, 2):
        if row['ASIN'] not in product_ids:
            continue
        candidate = row['candidate'].strip()
        if not candidate:
            continue
        for start, end, text in chunks(candidate):
            digest = sha(text)
            pid = f"epqa-{row['ASIN']}-{row['source']}-{digest[:16]}"
            origins.setdefault(pid, []).append({'row': row_number, 'qaPairId': row['qa_pair_id'], 'qid': row['qid']})
            if pid in passage_ids:
                continue
            passage_ids.add(pid)
            corpus['passages'].append({'id': pid, 'productId': row['ASIN'], 'source': row['source'], 'text': text,
                                       'reference': f'{url}#row={row_number}&qa_pair_id={row["qa_pair_id"]}&chars={start}-{end}', 'sha256': digest})
    for qid, first in selected:
        corpus['cases'].append({'id': f'epqa-final-{qid}', 'productId': product_by_qid[qid], 'question': first['question'].strip(),
                                'split': 'holdout', 'referenceAnswer': '', 'referencePassageIds': [],
                                'labelStatus': 'No answer label; independent human evidence review required'})
    output = OUT / 'final-corpus.json'
    output.write_text(json.dumps(corpus, indent=2, ensure_ascii=False) + '\n')
    manifest = {'upstreamCommit': COMMIT, 'upstreamTrainSha256': SOURCE_HASHES['train'], 'selectionSeed': SEED,
                'selectionRule': 'first 20 SHA256-ranked train qids with >=4 rows, 15-150 question chars, a bullet/attribute/review source, unique ASIN and unique first title token; exclude all existing development/validation ASINs',
                'selectedQids': [qid for qid, _ in selected], 'corpusSha256': sha(output.read_bytes()),
                'passageOrigins': origins, 'notes': ['Upstream test split untouched.', 'Labels and reference answers intentionally omitted.',
                'Source candidates are historical and human review is required.', 'First-title-token family separation is a heuristic; independent product-family audit pending.']}
    (OUT / 'final-manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'products': len(corpus['products']), 'passages': len(corpus['passages']), 'cases': len(corpus['cases']), 'sha256': manifest['corpusSha256']}))

if __name__ == '__main__':
    main()
