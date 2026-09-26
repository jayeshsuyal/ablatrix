#!/usr/bin/env python3
"""Rebuild the small, historical ePQA demo corpus. Never downloads the test split."""
import argparse, csv, hashlib, io, json, pathlib, re, urllib.request

COMMIT = 'cec976cc2f2218aa76e562ecc9c7d79f1f3271bc'
SOURCE = 'https://github.com/amazon-science/contextual-product-qa'
BASE = f'https://raw.githubusercontent.com/amazon-science/contextual-product-qa/{COMMIT}'
SOURCE_HASHES = {'train':'b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25',
                 'dev':'ec5c486592b59f2efb30abceb57c76fa55c2ff55333720a41d347cec601b024a'}
PICKS = {'train': ['349','416','438','743','770','775','585','728','647','635'],
         'dev': ['469','505','535','587','1985','2433']}
# Human-readable candidate interpretations, not audited evaluation truth.
GUIDANCE = {
 '349': 'The listing attribute says 12 pieces; community answers also describe a pack of 12 canvas panels.',
 '416': 'The bullet describes a roll 4 feet by 200 feet; 200 feet is the length, not 200 inches.',
 '438': 'The bullet specifies 40-weight polyester embroidery thread. The 10.3-pound item weight is a different measurement; a community answer gives 40–50 weight.',
 '743': 'The selected 40x10 variant has a 10-inch inseam according to its attribute. Community discussion also mentions a 12-inch option, which must not replace this variant specification.',
 '770': 'The product description says there is an internal water-bottle pocket.',
 '775': 'The material attribute lists engineered wood, glass, metal, and plastic. It does not establish a particular wood species or solid wood.',
 '585': 'The listing title specifies Verizon and a review says VS980, but community answers contradict each other about Verizon compatibility. State the conflict and confirm the exact model before guaranteeing fit.',
 '728': 'The description calls the fabric waterproof and breathable; reviews agree. Attribute that claim to the supplied description rather than treating it as independently tested performance.',
 '647': 'The brand/manufacturer attributes say Native Union. Reviews disagree about authenticity, so the snapshot cannot independently establish that every delivered handset is genuine.',
 '635': 'Samsung Galaxy S3 appears in compatible_phone_models. A review reports failure with a large Ballistic case, so bare-phone compatibility is not a guarantee for every case or configuration.',
 '469': 'The description says 240 pages, while reviews/community answers report about 100 or 112. Report the disagreement; the provided snapshot does not establish one reliable page count.',
 '505': 'The supplied descriptions identify a plastic base. They disagree about whether the legs are metal or plastic and how many legs there are, so avoid adding an unsupported leg specification.',
 '535': 'The compatible_phone_models attribute lists both iPhone 4 and iPhone 4S. Community answers also report fitting the 4S.',
 '587': 'The listed compatible models are iPhone SE (2016), 5/5s/5c, and iPod touch 5/6. Droid Turbo compatibility is not established; absence from that list alone does not prove physical incompatibility.',
 '1985': 'This selected listing is brown. The supplied evidence does not establish whether a separate black variant is sold; avoid claiming no black version exists.',
 '2433': 'The description says 12.8 pounds and the item_weight attribute says 11 pounds. Report that conflict rather than asserting one weight as certain.'
}

def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()

def chunks(text, max_chars=850):
    """Keep native units when short; split long units at whitespace with 80-char overlap.
    Runtime checks real tokenizer lengths and refuses >350-token passages (never truncates).
    """
    if len(text) <= max_chars: return [(0, len(text), text)]
    result, start = [], 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            boundary = max(text.rfind('\n', start + max_chars//2, end), text.rfind(' ', start + max_chars//2, end))
            if boundary > start: end = boundary
        result.append((start, end, text[start:end]))
        if end == len(text): break
        overlap = text.find(' ', max(start + 1, end - 80), end)
        start = overlap + 1 if overlap >= 0 else end
        while start < len(text) and text[start].isspace(): start += 1
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--raw-dir',default='work/epqa');parser.add_argument('--output-dir',default='data/product-qa');args=parser.parse_args()
    raw=pathlib.Path(args.raw_dir);raw.mkdir(parents=True,exist_ok=True)
    out=pathlib.Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    corpus={'version': f'epqa-demo-v1-{COMMIT[:12]}', 'source':SOURCE, 'license':'CDLA-Sharing-1.0', 'products':[], 'passages':[], 'cases':[]}
    manifest={'upstreamCommit':COMMIT,'upstream':SOURCE,'license':'CDLA-Sharing-1.0','licenseUrl':f'{SOURCE}/blob/{COMMIT}/LICENSE','files':{},'selection':PICKS,'notes':['Historical product snapshot; not current product advice.','Selection is purposive, not a representative benchmark.','Only train and dev downloaded; test remains untouched.','Product ASINs are disjoint between local development and validation.','No exhaustive brand/family deduplication audit; unsuitable for final benchmark claims.','Train/dev supply candidate text without a separate context column.','Reference guidance is AI-assisted interpretation, not the original dataset gold answer.','All annotation guidance remains pending independent human audit.'],'passageOrigins':{}}
    product_ids=set(); passage_map={}; original_labels={}
    for split,qids in PICKS.items():
        path=raw/f'{split}.csv';url=f'{BASE}/ePQA/{split}.csv'
        if not path.exists():path.write_bytes(urllib.request.urlopen(url,timeout=60).read())
        data=path.read_bytes()
        if sha(data) != SOURCE_HASHES[split]: raise ValueError(f'{split} checksum differs from pinned upstream; clear raw cache and investigate.')
        manifest['files'][split]={'url':url,'sha256':sha(data),'bytes':len(data)}
        rows=list(csv.DictReader(io.StringIO(data.decode())))
        if 'context' in rows[0]: raise ValueError('Schema changed: inspect separate context before regenerating.')
        local_split='development' if split=='train' else 'validation'
        selected=[]
        for qid in qids:
            rs=[r for r in rows if r['qid']==qid];assert rs,qid
            asin=rs[0]['ASIN'];assert asin not in product_ids, f'Product leakage: {asin}';product_ids.add(asin)
            corpus['products'].append({'id':asin,'title':rs[0]['title'],'split':local_split});selected.append((qid,asin,rs))
        selected_asins={s[1] for s in selected}
        # Full selected-product pools from this source split, including nonselected questions
        # and label-0 distractors. Gold answer and relevance label are NEVER search text.
        for row_number,r in enumerate(rows,2):
            if r['ASIN'] not in selected_asins:continue
            text=r['candidate'].strip()
            for start,end,part in chunks(text):
                digest=sha(part);key=(r['ASIN'],r['source'],digest);pid=f"epqa-{r['ASIN']}-{r['source']}-{digest[:16]}"
                origin={'split':split,'row':row_number,'qaPairId':r['qa_pair_id'],'qid':r['qid'],'start':start,'end':end,'candidateSha256':sha(text)}
                if key not in passage_map:
                    passage={'id':pid,'productId':r['ASIN'],'source':r['source'],'text':part,'reference':f'{url}#row={row_number}&qa_pair_id={r["qa_pair_id"]}&chars={start}-{end}','sha256':digest}
                    passage_map[key]=passage;corpus['passages'].append(passage);manifest['passageOrigins'][pid]=[]
                manifest['passageOrigins'][pid].append(origin)
                original_labels.setdefault((split,r['qid']),[]).append({'passageId':pid,'qaPairId':r['qa_pair_id'],'label':int(r['label']),'answer':r['answer']})
        for qid,asin,rs in selected:
            labeled=original_labels[(split,qid)]
            corpus['cases'].append({'id':f'epqa-{split}-{qid}','productId':asin,'question':rs[0]['question'],'split':local_split,'referenceAnswer':GUIDANCE[qid],'referencePassageIds':list(dict.fromkeys(x['passageId'] for x in labeled if x['label']==2)),'labelStatus':'AI-assisted dataset-derived guidance; independent human audit pending'})
    (out/'corpus.json').write_text(json.dumps(corpus,indent=2,ensure_ascii=False)+'\n')
    manifest['corpusSha256']=sha((out/'corpus.json').read_bytes())
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
    annotations={f'{split}-{qid}':original_labels[(split,qid)] for split,qids in PICKS.items() for qid in qids}
    (out/'annotations.json').write_text(json.dumps(annotations,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'products':len(corpus['products']),'passages':len(corpus['passages']),'cases':len(corpus['cases']),'largestChunkChars':max(len(p['text']) for p in corpus['passages']),'corpusSha256':manifest['corpusSha256']}))

if __name__=='__main__':main()
