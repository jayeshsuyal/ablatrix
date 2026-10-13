# Fresh flat-ID correction comparison

**Status: unexecuted historical preparation; new execution qualification required.** The October 12 [retrieval contract fix](automated-reliability.md) changes a code hash bound by this plan. Its existing verification must reject the changed implementation. Every preparation artifact below is preserved; no calls or judgments were made for this cohort. The user has redirected current work toward automated RAG and harness gates. Any future paid comparison needs a newly qualified plan and explicit budget approval. This preparation uses eight products excluded from the prior inspected set, one common original per product and two sibling revisions. There is no quality result yet.

## Frozen inputs

The [cohort](evidence/flat-source-quality-2026-10-11/cohort.json) has 203 complete source chunks; the [retrieval snapshot](evidence/flat-source-quality-2026-10-11/retrieval.json) selects 40, preserving separate customer questions. The [source audit](evidence/flat-source-quality-2026-10-11/source-sufficiency-audit.json) records support, conflicts and relevant omitted sources before generation.

| Probe | Case | Source condition |
| --- | --- | --- |
| Container dimensions | 5841 | Listing dimensions and differently scoped size reports. |
| Luggage weighing | 11514 | Direct customer use reports with platform caveats. |
| Pant material | 9568 | Mesh descriptions; listing composition omitted by retrieval. |
| Sock color | 9611 | Ambiguous color variants; exact top color unestablished. |
| Sustain pedal | 11368 | An exact target-model customer report among other-model answers. |
| Sewing needles | 391 | Other-model compatibility reports; requested model unestablished. |
| Filter replacement | 1404 | Related filter/valve reports; exact replacement unestablished. |
| Included pen | 11509 | Consistent customer accessory-exclusion reports. |

The [exposure inventory](evidence/flat-source-quality-2026-10-11/exposure-audit.json) protects 82 prior products and current workspace/comparison metadata. The [family audit](evidence/flat-source-quality-2026-10-11/manual-family-audit.json) records source-model and pool comparisons, including shared Brother target-brand context in two different consumable families. Complete protected train pools could not be reconstructed for three products; available titles, identifiers and metadata remain protected. These checks establish the recorded exclusions, not statistical independence.

Two private preparation drafts are preserved. One named the wrong citation field; the other exposed an electrical-amperage question incorrectly classified as physical capacity. A [source-only amendment](evidence/flat-source-quality-2026-10-11/preparation-amendment-v3.json) records both repairs, the unchanged seed, and the uniform eligibility change before any output existed. The full rejection log stays local; its [summary and hashes](evidence/flat-source-quality-2026-10-11/selection-summary.json) support deterministic replay. Cohort status fields describe its earlier candidate snapshot; the subsequent execution manifest is the authoritative freeze.

## Reproduce and inspect without paid calls

After `npm ci`, supply the pinned train file whose checksum and upstream revision are recorded in the cohort:

```sh
python3 scripts/prepare-flat-source-cohort.py \
  --train /absolute/path/train.csv \
  --exposure-audit docs/evidence/flat-source-quality-2026-10-11/exposure-audit.json \
  --prepare-dir /tmp/ablatrix-flat-replay
```

The replay uses the captured metadata. It does not inspect current databases or establish current freshness. It reads only source/question/title columns and never uses relevance labels, reference answers or model outputs. The full cohort, exposure and rejection-log bytes reproduce.

```sh
python3 -m unittest scripts/test_prepare_flat_source_cohort.py
node --import tsx --test server/flat-source-comparison.test.ts
node --import tsx scripts/flat-source-comparison.ts --verify \
  --plan docs/evidence/flat-source-quality-2026-10-11/execution-plan.json
```

The last command now intentionally fails the implementation binding on the current retriever. The published qualification records the earlier code and remains inspectable in repository history.

The [qualification](evidence/flat-source-quality-2026-10-11/offline-qualification.json) binds tested code and historical records. Verification reconstructs the [manifest](evidence/flat-source-quality-2026-10-11/execution-plan.json) and its request templates without credentials, a paid provider or on-disk review/ledger access. The real retrieval used cached pinned CPU embeddings with network requests disabled.

## Proposed run and review

Generate all eight originals first. Then generate sixteen revisions, alternating baseline/candidate order within each pair. Both arms receive the same actual original, fixed AI-authored rubric, ordered sources, model route, flat-ID schema and generation settings. Only the existing revision-policy bundle differs. Revision bodies are derived and hashed from the actual accepted original before dispatch; preparation placeholders are never dispatched.

The maximum is **24 new attempts**, with **$2.40 additional planning allowance**. Ledger 86→110 proposes **$11.200281 total: $11 in reservations plus the $0.200281 prior-spend adjustment**, under a new **$12 local planning cap**. This exceeds the previous authority and needs explicit approval for the exact frozen manifest. These reservations are not settled charges or a provider-enforced cap.

Execution requires live opt-in, exact plan-hash approval, verified merged code and the audited database paths. It repeatedly checks application ownership, ledger/review history, source-only exposure metadata and public product disclosures before reservations/transport and after responses. New disclosures or changed bound artifacts stop execution. Checks detect activity; they cannot undo a request already in flight.

Stop on the first failure or uncertain outcome. Preserve every planned step, failure and unattempted arm; no retry, coercion, web call or replacement. No reservation means `not_attempted`. A failed original keeps the full execution record outside the review importer; only a full eight-case packet with completed originals can be imported. Missing arms leave overall quality incomplete.

At `/compare`, save **16 independent blind human judgments** against the full source pools. Correctness, support and adequacy are separate from exact citation membership. The report separately counts correct→incorrect and supported→unsupported transitions, with resolved, uncertain and pending denominators. Uncertainty on another axis does not hide an observed regression.

The shared AI rubric is a generation input, not a human review or training update. Results remain exploratory, with imported-provider/prospectivity limitations, `qualityClaimEligible: false`, and no automatic promotion. A useful sample must improve all-three-positive answers without new correctness/support regressions; unresolved reviews remain inconclusive.
