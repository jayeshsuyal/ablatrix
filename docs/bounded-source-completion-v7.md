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

The [aggregate result](results/bounded-source-completion-v7-2026-10-20/development-report-v2.json) and [development freeze](results/bounded-source-completion-v7-2026-10-20/development-freeze-v2.json) bind the exact implementation and input artifacts. Version 2 retains every older source-review assessment, including uncertain-case notes, alongside all APQA unknowns and applicability qualifications; contexts and counts are unchanged from the preserved first replay. Full source-aware rows stay private. Source-checked human answers, generated answers and new paid provider calls are zero; quality and activation flags are false.

```sh
node --import tsx scripts/retrieval-development-v7.ts --freeze PRIVATE_INPUTS NEW_ABSOLUTE_FREEZE
node --import tsx scripts/retrieval-development-v7.ts --run PRIVATE_FREEZE NEW_ABSOLUTE_RESULT
node --import tsx scripts/retrieval-development-v7.ts --verify PRIVATE_FREEZE PRIVATE_RESULT
node --import tsx --test server/semantic-supplement-v7.test.ts
```

## Next untouched-product protocol

The next version fixes v6 versus v7 before source access. It protects both consumed 16 MiB frames, maps every complete previously consumed row into exclusion history, and resolves the next transport-boundary row for exclusion only. The next 32–48 MiB interval of the same immutable official object is the sole acquisition; no source, range expansion, replacement or reseeding follows an outcome.

The fixed screen inspects at most 4,096 complete question records, seeks the first 32 mechanically eligible product-disjoint packets, and selects the first sixteen source-eligible unique products after two independent automatic source reviews and third adjudication. All designated facts and retained unknowns precede contexts. Customer reports, source conflicts, complete controls, candidate misses and packets where v7 cannot complete remain eligible under the same source rules; selection never filters on v7 applicability or gain. A short pool stops without replacement. Retrieval alone cannot authorize paid answers or establish generated-answer improvement.

The versioned implementation has three separate entry points:

1. `scripts/amazon-pqa-consumed-history-v4.ts` maps every complete row in the already consumed second frame, unions the original fully replayed history, and resolves only the old trailing row against the new first physical line. Both entire intervals remain consumed, including all alternatives, rejected rows and annotation commitments. Pending boundary history permits opaque custody only. Historical proofs reconstruct from raw bytes; no trusted cross-process verification cache is introduced.
2. `scripts/acquire-amazon-pqa-v4.py` freezes metadata and implementation closure, checks two independent AI reviews and adjudication, journals the single conditional anonymous GET, and seals the exact third frame. It disables redirects, proxies, retries and overwrite/resume; failure retains its attempt and partial-byte hashes. It never parses source records or authorizes semantic access.
3. `scripts/amazon-pqa-validation-v4.ts` binds the resolved complete history, native pin, implementation closure, cached model hashes and new source-access reviews before opening fresh records. It uses immutable v1 math only through an explicitly named **source-eligibility-only in-memory projection**. Persisted protocol, comparison and report identify the actual v6/v7 arms. Both receive the same observed query/document scores; the candidate retains every control passage. Final verification replays raw screening, reviews, selection, stages, contexts and units.

All three CLIs are offline except the separately reviewed acquisition command. No provider execution mode is exposed by the v4 validation CLI. Existing v1/v2/v3 source, runtime and report files remain byte-identical.

The actual consumed-frame mapping covers **9,151 complete rows**, including 5,055 beyond the original screen, and unions 8,481 protected products. The remaining 1,748-byte trailing fragment is explicitly unresolved until reviewed adjacent-row exclusion. This mapping creates history only, with zero fresh cases. Local verification passes 824 server tests with one platform skip, all eighteen focused selector/history/validation tests, 33 acquisition/history Python tests, strict script TypeScript and the production build. The next frame has not been decoded into fresh cases at this checkpoint.
