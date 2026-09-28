# Ablatrix paid product QA batch — 2026-09-28

## Protocol

- Pinned source: Amazon Science ePQA `train.csv` at commit `cec976cc2f2218aa76e562ecc9c7d79f1f3271bc`, verified SHA-256 `b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25`.
- Fixed manifest SHA-256: `125def79dfcd8823e1ca5c38b125fcdc5bdfcbd55222e4cbc1236c6b3a666dd2`. It was saved before paid dispatch. The first 20 eligible numeric question IDs were chosen, one per product, excluding all 36 products in Ablatrix's curated development, validation, and final corpora.
- Each product supplied up to eight source excerpts: up to three originally relevance-labeled `2` excerpts first, followed by other candidates in source row order. The original labels and reference answers were withheld from the model. CQA echoes of the question were removed. This is a **curated-evidence answer test**, not a full-corpus retrieval benchmark.
- All 20 products passed local retrieval previews before any paid call. One paid answer call was made per case, in fixed order, without retries. The run used the frozen workspace baseline policy and shared Sapiom Router planning ledger.

## Observed results

| Measure | Result |
| --- | ---: |
| Distinct products / paid attempts | 20 / 20 |
| Completed attempts / new failures | 20 / 0 |
| Model-reported `answered` / `insufficient_evidence` | 14 / 6 |
| Exact citation quotes found in returned passages | 52 / 52 |
| Retrievals containing an originally relevance-labeled `2` passage | 20 / 20 |
| Answers citing at least one originally relevance-labeled `2` passage | 14 / 20 |
| Citations to originally relevance-labeled `2` passages | 21 / 52 |
| Model identity | `gpt-5.6-luna` on all 20 |
| Input / output tokens | 21,701 / 2,142 |
| Median / 95th-percentile client response time | 2.405 s / 3.148 s |
| New local planning allowance | $2.00 (20 × $0.10) |

The shared ledger moved from 38 to 58 recorded attempts, with 20 new completed attempts and no new failures. Its cumulative local allowance is $5.80, plus $0.200281 configured prior spend, within the previously approved $10 planning cap. Actual provider charges are unavailable in this ledger.

The `insufficient_evidence` cases were question IDs `25`, `32`, `47`, `54`, `72`, and `81`. Original relevance labels are a retrieval diagnostic; they do not prove an answer is correct or that a cited sentence supports every claim. Exact quote membership is also a provenance check, not a semantic correctness score. The source selection deliberately included known relevant candidates, the sample is an early train-split slice, and the public reference answers can be incomplete or contradictory. No independent human correctness review or baseline-versus-candidate quality gain is claimed.

See `manifest.json` for the fixed inputs and original source labels, and `results.json` for every saved answer, citation, retrieved passage, model identity, token count, and timing. The next quality measurement should review these answers against the source text, then compare a change on fresh product-disjoint cases.
