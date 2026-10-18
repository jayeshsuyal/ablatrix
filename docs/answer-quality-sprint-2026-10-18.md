# Source interpretation and answer quality

October 18, 2026. The candidate is experimental. The approved 16-call comparison completed; two blind AI reviews show one agreed substantive candidate preference, six ties and one disputed benefit. Human judgments remain 0/16, and broad quality gain or policy promotion is not established. See the [live results](evidence/answer-quality-source-calibration-2026-10-18/RESULTS.md).

## Diagnosis from saved, exposed answers

The strongest repeated problem is interpretation after retrieval: useful source facts are already available, but the answer changes their confidence, invents a conflict or fails to separate a supported fact from an unresolved relationship. This audit is an AI source check of deliberately inspected development examples, not a random-sample error rate.

| Exposed example | Saved defect | What the change should preserve |
| --- | --- | --- |
| [Cabinet material](evidence/answer-calibration-revision2-development-blind-review-2026-09-25.md) | Compatible pressed-wood/particle-board descriptions are called conflicting; an explicit listing claim receives an unrelated independent-verification caveat. | Attribute the listing and customer descriptions; identify an actual incompatible same-scope claim before declaring conflict. |
| [Q63 keg capacity](evidence/paid-qa-batch-2026-09-28/results.json) | The retrieved listing documents its configurations, but the original gives a definite “No” from a tentative customer statement. | Report documented configurations and preserve the specific gap about the requested arrangement. An unlisted configuration is not thereby physically impossible. |
| [Q19 replacement drawer](evidence/q19-live-revision-2026-09-29.md) | A customer response about another model is applied to the current questioner. Its original customer question was absent from the historical input. | Keep original-question context and exact requested-model scope. The current workspace already preserves this context; this is a regression control. |
| [Q26 handle color](evidence/correction-policy-2026-10-10/development-results.json) | The original speculates about an unseen image; later prose repeats several customer descriptions. | Summarize the reported shade with attribution and leave the exact manufacturer shade unresolved. |
| [iPhone 4S case](evidence/answer-calibration-revision2-validation-blind-review-2026-09-25.md) | A candidate emphasizes an iPhone 4 report despite an available iPhone 4S report. | Prefer support for the exact requested relationship. |
| [Q72 venting](evidence/paid-qa-batch-2026-09-28/results.json) | The answer repeats a citation and the retrieved set lacks a relevant listing bullet. | Preserve the useful supported top/rear-vent fact and the unresolved installation requirements. This audit does not establish a general retrieval defect. |

The original public 20-answer batch uses the word “evidence” in 19 answers, 25 occurrences total. This is a reproducible wording count, not an accuracy score. Full-source citation matching and answer quality remain separate.

Controls include Q25's unresolved complete thread specifications, Q47's missing WMR200 compatibility, Q4's opposing suitability reports, and Q75's positively supported stacked-appliance use. Concision must not erase qualifications, genuine conflicts or useful positive reports.

## One controlled change

The new opt-in `workspace-answer-source-calibration-v2` contract targets source interpretation and calibration: direct supported answer, relevant source attribution, then the precise remaining gap when needed. It preserves tentative statements, conditional claims and original customer-question scope. It asks for a model number only when that identifier is missing, and does not infer facts about unseen images.

The [candidate instruction freeze](evidence/answer-quality-source-calibration-2026-10-18/candidate-freeze-v1.json) predates selection of the separate test packet. Historical workspace v1 and revision request bytes remain reproducible. The ordinary workspace default and live grader/policy gates remain unchanged during comparison.

Retrieval, model route, source order, citation schema and answer-length bound are held constant between arms. A possible long-parent retrieval-crowding issue was inspected but not reproduced in the exposed natural examples; this sprint does not change ranking from that hypothesis.

## Separate-question comparison

Select eight source/question-only products from the pinned ePQA train corpus, excluding historical, reserved and current workspace/comparison exposures and related families. Preserve full reviewer sources and freeze the same retrieved source bodies for both answers. References, upstream relevance labels and generated outcomes must not influence selection. Source and family review must finish before generation.

Generate one baseline and one candidate first answer per question, alternating arm order. The maximum is 16 new provider attempts at $0.10 local planning allowance per attempt, subject to the exact final starting-state and code-bound plan. Stop on the first invalid or unknown result, preserve all planned arms, and do not retry or replace cases. The concrete plan received explicit financial approval before the recorded execution; its proposal bytes remain preserved.

An anonymous source-review worksheet will assess correctness, actual cited support, useful coverage, confidence and directness separately. Record paired wins, losses, ties, uncertain and incomplete cases, including factual/support regressions, total attempts, elapsed time and usage. AI review retains AI provenance. Human-reviewed quality and policy promotion require the repository's independent source-check and fresh-validation gates; the v4 grader is not used to grade itself or authorize this comparison.

A successful transport test is not an answer-quality result. A small eight-product comparison would be exploratory and would not establish a general correctness rate or a learning curve.

## Preparation and engineering checks

Independent source-only review rejected the first draft for a pressure-vessel probe and an overlapping appliance-parts family. The [first prospective amendment](evidence/answer-quality-source-calibration-2026-10-18/pre-generation-amendment-v1.json) records uniform safety/family rules and the corrected inventory of both active and configured canonical workspace stores. A second source-only draft exposed a missing KitchenAid alias; the [second amendment](evidence/answer-quality-source-calibration-2026-10-18/pre-generation-amendment-v2.json) records that correction. All sixteen reviewed products, related families, source packets and model identifiers are protected before the next selection. Both drafts and failed reviews retain their original bytes privately. No generated outcome informed an amendment; the candidate prompt and selection seed stayed fixed.

The shared ledger was checked read-only: 122 attempts, $12.20 reserved, $0.200281 prior adjustment, zero pending reservations and zero owners. Sixteen further attempts would reserve at most $1.60, reach 138 attempts and $14.000281 combined planning usage under a $20 local cap. The reviewed code-bound plan received explicit chat approval and all sixteen calls completed. The final ledger has 138 attempts, $13.80 reserved, the same $0.200281 adjustment and zero pending/owners. These are local planning reservations, not settled charges.

The server suite passes 555 tests with one platform skip; 13 existing ask/context/review browser checks, 24 Python selector tests, production build and standalone CLI/retrieval script typechecks pass. The saved historical development proof still verifies with its original hash and explicit absent legacy final-delivery metrics. New synthetic tests establish bounded execution and accounting mechanics only; they do not score answer quality.

## Frozen separate-question plan

The final [eight-product source packet](evidence/answer-quality-source-calibration-2026-10-18/cohort-v1.json), [cached-BGE retrieval](evidence/answer-quality-source-calibration-2026-10-18/retrieval-v1.json) and [independent AI source/family review](evidence/answer-quality-source-calibration-2026-10-18/source-family-review-v1.json) preserve 161 reviewer passages and 39 selected complete source bodies. The review passed with no remaining eligibility blockers. Its expected facts, missing relationships and prohibited inferences were written before any generated answer. Relevant missing information and conflicts remain in the packet.

The [selection summary](evidence/answer-quality-source-calibration-2026-10-18/selection-summary-v1.json) records both rejected drafts and their private audit commitments. The [public bounded plan](evidence/answer-quality-source-calibration-2026-10-18/bounded-plan-v2.json) records all sixteen request hashes and the exact proposed allowance. The execution plan additionally binds private canonical store paths and historical ledger commitments; those host details are not public.

Plan `d1d1c49c6d47edcf2c9dae4351701c42b531d362fd5b42acc1184433e8a8a78e` passes preparation and offline verification with zero provider calls. It supersedes the preserved, unapproved v1 plan after review required stronger pre-generation cohort seals and exactly one rejection review per prior draft. The source packet and candidate prompt are unchanged. Historical selection code at `fa49ba7` is pinned separately from current validation code at `f32d15e`; immutable helper hashes and actual inventory-path commitments are checked. The preserved proposal retains its original unapproved flags; the later [execution record](evidence/answer-quality-source-calibration-2026-10-18/live-execution-record-v1.json) records exact chat approval and completion. The [assessment](evidence/answer-quality-source-calibration-2026-10-18/comparison-assessment-v1.json) preserves both independent AI reviews and their disagreement. No default, grader or policy activation followed.

Before execution, the preparing host verified without loading credentials or creating a provider:

```sh
node --import tsx scripts/source-calibration-comparison.ts --verify \
  --plan .data/source-calibration-2026-10-18/plan-v2.json
```

After outcomes are published, the frozen live plan is consumed and its exposure preflight is intentionally stale. The [results report](evidence/answer-quality-source-calibration-2026-10-18/RESULTS.md) provides public offline citation reproduction and explains its narrower scope.
