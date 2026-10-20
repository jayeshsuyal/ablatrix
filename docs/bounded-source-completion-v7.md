# Bounded source completion v7

The frozen APQA v5/v6 result remains **20/24 designated source units in both arms**, with no fresh v6 gain. Four designated parents reached dense retrieval and the cross-encoder but missed the five-chunk hybrid selection and then fell below the reranker's −5 absolute floor. These were heat-control details (−9.796), a conflicting fastening report (−7.685), connector dimensions (−8.344) and a short size bullet (−8.562). The last case already had equivalent dimensions in its delivered description: its recorded miss is exact source/quote delivery, not absent information.

## Separate development candidate

`server/semantic-supplement-v7.ts` preserves every v6 passage, its order, labels, original customer question and metadata. If the **entire remaining product packet** fits the existing three additions relative to the original baseline, eight parents, 1,500 UTF-16 units per parent and 12,000 body units, it appends the remaining literal bodies in original source order. Only exact body-plus-original-question duplicates collapse. Otherwise it returns exact v6 passages, with no partial completion. Every parent first passes inherited validation against the frozen chunk corpus; an unscored parent receives null reranker metadata.

Completion uses no product-specific condition, question term, designated fact, target answer or outcome. The model, scores, relevance thresholds, uncertainty instructions and old implementations remain unchanged. This is a separate experimental selector; answer-policy promotion remains closed.

## Exposed development result

The fixed replay retains all twelve older products and all sixteen now-exposed APQA products. It recomputes lexical/fusion/selection stages with saved dense observations and exact input-bound MiniLM logits; it does not represent new model inference or independent questions.

| Fixed cohort | Designated source units | v6 delivered | v7 delivered | Lost |
|---|---:|---:|---:|---:|
| Older development | 13 | 13 | 13 | 0 |
| APQA development | 24 | 20 | 24 | 0 |
| Combined | 37 | 33 | 37 | 0 |

All 28 full v6 prefixes remain exact. Fourteen APQA packets fit completion; nine contexts change, appending thirteen parents and 840 body UTF-16 units in total. The other two APQA cases and all twelve older cases retain exact v6 passages. The unchanged strict source matcher counts the redundant size bullet described above. These are source-delivery counts, not answer accuracy, and not a résumé percentage for fresh answer improvement.

Five older uncertain cases have no complete designated-fact label and remain in the deck. The 37-unit denominator does not label their whole answers or turn them into successful cases.

The [aggregate result](results/bounded-source-completion-v7-2026-10-20/development-report-v2.json) and [development freeze](results/bounded-source-completion-v7-2026-10-20/development-freeze-v2.json) bind the exact implementation and input artifacts. Version 2 retains every older source-review assessment, including uncertain-case notes, alongside all APQA unknowns and applicability qualifications; contexts and counts are unchanged from the preserved first replay. Full source-aware rows stay private. Source-checked human answers, generated answers and new paid provider calls are zero; quality and activation flags are false.

```sh
node --import tsx scripts/retrieval-development-v7.ts --freeze PRIVATE_INPUTS NEW_ABSOLUTE_FREEZE
node --import tsx scripts/retrieval-development-v7.ts --run PRIVATE_FREEZE NEW_ABSOLUTE_RESULT
node --import tsx scripts/retrieval-development-v7.ts --verify PRIVATE_FREEZE PRIVATE_RESULT
node --import tsx --test server/semantic-supplement-v7.test.ts
```

## Frozen fresh-product protocol

The new version fixed v6 versus v7 before source access. It protected both consumed 16 MiB frames, mapped every complete previously consumed row into exclusion history, and resolved the next transport-boundary row for exclusion only. The fixed 32–48 MiB interval of the same immutable official object was the sole acquisition; no source, range expansion, replacement or reseeding followed an outcome.

The fixed screen inspects at most 4,096 complete question records, seeks the first 32 mechanically eligible product-disjoint packets, and selects the first sixteen source-eligible unique products after two independent automatic source reviews and third adjudication. All designated facts and retained unknowns precede contexts. Customer reports, source conflicts, complete controls, candidate misses and packets where v7 cannot complete remain eligible under the same source rules; selection never filters on v7 applicability or gain. A short pool stops without replacement. Retrieval alone cannot authorize paid answers or establish generated-answer improvement.

The versioned implementation has three separate entry points:

1. `scripts/amazon-pqa-consumed-history-v4.ts` maps every complete row in the already consumed second frame, unions the original fully replayed history, and resolves only the old trailing row against the new first physical line. Both entire intervals remain consumed, including all alternatives, rejected rows and annotation commitments. Pending boundary history permits opaque custody only. Historical proofs reconstruct from raw bytes; no trusted cross-process verification cache is introduced.
2. `scripts/acquire-amazon-pqa-v4.py` freezes metadata and implementation closure, checks two independent AI reviews and adjudication, journals the single conditional anonymous GET, and seals the exact third frame. It disables redirects, proxies, retries and overwrite/resume; failure retains its attempt and partial-byte hashes. It never parses source records or authorizes semantic access.
3. `scripts/amazon-pqa-validation-v4.ts` binds the resolved complete history, native pin, implementation closure, cached model hashes and new source-access reviews before opening fresh records. It uses immutable v1 math only through an explicitly named **source-eligibility-only in-memory projection**. Persisted protocol, comparison and report identify the actual v6/v7 arms. Both receive the same observed query/document scores; the candidate retains every control passage. Final verification replays raw screening, reviews, selection, stages, contexts and units.

All three CLIs are offline except the separately reviewed acquisition command. No provider execution mode is exposed by the v4 validation CLI. Existing v1/v2/v3 source, runtime and report files remain byte-identical.

The actual consumed-frame mapping covers **9,151 complete rows**, including 5,055 beyond the original screen, and unions 8,481 protected products. Reviewed boundary exclusion joined the old 1,748-byte fragment with 1,231 leading bytes, reconstructing one old row and zero new complete rows. One anonymous GET sealed exactly 16 MiB. Three source-access reviews bound the resolved history and exact implementation before the fixed fresh screen.

## Fresh result: no v7 gain

The actual screen inspected **4,096 records across 734 products**, producing the fixed 32-packet pool with 226 parents. Two independent source reviews and adjudication left 18 eligible packets, 13 source-review rejects and one uncertain packet. The first sixteen eligible products were selected in source order; the later heater and watch remained unselected. The indoor/outdoor placement disagreement stays uncertain, the hair-snag target paraphrase is excluded, and the unsupported, overlapping price-comparison packet is excluded. Every mechanical exclusion and independent unknown remains recorded.

A source-only unit audit removed duplicate or peripheral designations before either context or model score was available. The preliminary same-product 55-unit selection and original reviews are preserved privately; the final selection freezes **47 distinct attributed source units**. All sixteen selected cases retain unknowns. Different released customer response slots do not establish independent authors or verified real-world tests.

| Fresh measure | v6 | v7 |
|---|---:|---:|
| Predesignated source units delivered | 38/47 | 38/47 |
| Cases delivering every designated unit | 12/16 | 12/16 |
| Recovered / lost units | — | 0 / 0 |

Actual cached BGE/MiniLM inference used the pinned local assets with network dispatch disabled. V7 preserved every full v6 prefix. Eight packets were already complete; four more fit completion, adding five parents and 600 body UTF-16 units across four cases already delivering every designated unit in v6. The four oversized packets retained exact v6, including all nine missed units. Thus twelve cases have exact v6 passages: eight already complete and four oversized fallbacks. None was removed from the result.

This experiment shows **no fresh designated-source delivery gain**. It does not measure answer accuracy: the 32 answer slots are unexecuted design counts, generated answers and new provider calls are zero, human source-checked answers remain zero, and quality/activation flags remain false. The no-benefit stop leaves the paid plan null. V7 stays experimental; the old development recovery and the original v5/v6 negative result remain separate.

The [fresh aggregate report](results/bounded-source-completion-v7-2026-10-20/fresh-report-v1.json), [prospective freeze](results/bounded-source-completion-v7-2026-10-20/fresh-freeze-v1.json) and [replay provenance](results/bounded-source-completion-v7-2026-10-20/fresh-provenance-v1.json) bind the exact private artifacts. The entire third frame, its rejected rows and unparsed tail are now consumed and cannot be reused as fresh validation.

```sh
node --import tsx scripts/amazon-pqa-validation-v4.ts --verify --input PRIVATE_FINAL_INPUT
```

Implementation verification passes 824 server tests with one platform skip, eighteen focused selector/history/validation tests, 33 acquisition/history Python tests, strict script TypeScript and the production build. The frozen implementation commit is `3a455ffccba424ade5af5a7722fa8e94d7ccb70e`; its exact CI passed. All 74 code pins, nine cached assets, 68 older runtime pins and 269 protected historical files remain unchanged.
