# Fresh correction cohort: preparation

This is an eight-product, exploratory comparison of **revision instructions**. It does not measure first-pass improvement or train a model. Each product receives one fresh original answer and two revisions of that same original, using the same critique and ordered source passages. Only the revision instruction variant changes.

**Final source freeze:** [cohort v3](cohort-v3.json), eight products and 174 source chunks, passed its separate [family/source audit](manual-family-audit-v3.json). The earlier [v1](manual-family-audit.json) and [v2](manual-family-audit-v2.json) failed before any fresh answer generation. The prospective [v2](preparation-amendment-v2.md) and [v3](preparation-amendment-v3.md) amendments explain the eligibility repairs. The source cohort is immutable; the execution manifest separately binds retrieval and policy inputs.

## Selection before generation

`scripts/prepare-correction-cohort.py` reads the pinned ePQA train CSV (`b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25`). It does not download or read the test split, instantiate a provider, inspect model answers, or write a database. Dataset answer and relevance-label columns are excluded from its working records.

The fixed seed is `ablatrix-correction-policy-2026-10-10-v1`. Within each group, eligible questions are ranked by SHA256 of seed, group, and upstream question ID. The first eligible, distinct product family is selected:

| Question/source group | Products |
| --- | ---: |
| Capacity or dimensions with a numeric listing statement | 2 |
| Appearance or material with a listing statement | 2 |
| Model compatibility with differently scoped customer Q&A | 2 |
| Requested model relationship absent from source-body identifiers | 1 |
| Factual question for checking preservation of an adequate answer | 1 |

These are deterministic sampling heuristics, not answer labels. In particular, a preservation control may still produce an incorrect original, and token absence does not prove that a full source review will find no answer. No case is selected because an original or revision performed badly. A source/family audit and offline retrieval preflight must finish before dispatch; an unexpected incompatibility stops the run rather than silently replacing a case.

All 56 historical/reserved ASINs are excluded: the development/validation corpus, the separate final corpus, and the paid 20-case packet. This protects the two remaining legacy validation products and the entire final cohort. The script also inventories workspace products and previous live comparison exposures read-only, and conservatively excludes other public ASIN references. Brand-token matches, exact title model/part matches, and title-token Jaccard similarity of at least 0.45 block related products. V3 additionally checks full source/question/title identifiers for exact and near model-family matches, excluding generic measurement tokens. Selected families must differ from each other. These checks support, but do not replace, the recorded manual source/family audit.

The initial local inventory mapped every workspace product to the existing historical exclusion set; the comparison ledger contained only synthetic fixtures. The pinned train file contains 121,750 rows and 5,393 products. Fifty-five of the 56 protected ASINs occur in train. The preparation script reports its remaining candidate counts without selecting or printing fresh cases in inventory mode.

## Source and critique freeze

For each selected ASIN, the full train source pool is retained, including distractors and sources attached to other customer questions. Deduplication binds source type, exact body, and original customer question. CQA `Question:` suffixes are separated into metadata; they are never quoted as factual evidence. Each body is split into at most 850-character chunks with bounded overlap; original rows, QA-pair IDs, body offsets, and raw candidate hashes remain available. Any unsupported pool is rejected as a whole. The reviewer pool is bounded at 128 chunks.

Source hashes use the same identity, label, body, original-question, and reference tuple as `workspaceReviewSourceHash`. Repeated “Yes” answers to different questions therefore retain different source identities. The existing hybrid retriever selects from the complete pool offline. Its ordered passage IDs must be saved before generation, with at most eight passages, and shared by both revision arms. The preparation JSON deliberately records `retrievalFrozen: false`; it is not sufficient authorization for dispatch.

Every case uses the same prewritten, conditional critique. It asks for a concise, supported answer, correction of genuine errors, preservation of a correct original, and calibrated uncertainty where information is missing. It is explicitly **AI-authored development feedback**, not a human rejection. No critique is adapted after reading either revision.

## Commands

Inventory requires the existing pinned cache and all relevant local exposure inventories. Paths below are operator-supplied arguments, not portable files included in the evidence packet:

```sh
python3 scripts/prepare-correction-cohort.py \
  --train PATH_TO_PINNED_TRAIN \
  --workspace-db PATH_TO_WORKSPACE_DB \
  --comparison-db PATH_TO_COMPARISON_DB
```

Repeat `--workspace-db` for every relevant workspace. Add `--development-gate-passed --out NEW_COHORT_JSON` only after the development check qualifies. The command refuses to overwrite an output. A frozen packet includes the exclusion audit without credentials or private filesystem paths, allowing later reproduction without those private databases:

```sh
python3 scripts/prepare-correction-cohort.py \
  --train PATH_TO_PINNED_TRAIN \
  --exposure-audit FROZEN_COHORT_JSON \
  --development-gate-passed --out NEW_REPLAY_JSON
```

Use the same preparation-script revision and pinned exclusion files when reproducing the hash. Raw ePQA content remains under [CDLA-Sharing-1.0](../../../data/product-qa/LICENSE).

## Execution and interpretation

The fresh comparison plans 24 attempts: eight originals and sixteen revisions, at a **$2.40 local planning allowance**. It permits no web calls, automatic retries, or case replacement. This is part of the approved total of at most 30 new attempts including development. A local planning allowance is not settled provider billing or a provider-enforced spending cap.

Provider receipts, failures, input hashes, model identity, timings, and token usage must be retained. Failed or uncertain attempts make the comparison incomplete. Independent human source checks of all sixteen revision answers remain necessary. Exact quote membership is reported separately from correctness, support, and adequacy. AI assessments do not fill human-review fields. Eight products can provide an initial descriptive signal; they cannot establish broad generalization or justify automatic policy promotion.
