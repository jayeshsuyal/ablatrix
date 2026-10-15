# Abstention-aware grader v2

The earlier [live grader pilot](evidence/grader-calibration-2026-10-14/live-results.md) stopped when the model labeled a sensible refusal `supported` but supplied no proof. The validator correctly rejected that output. V2 clarifies the grading instructions while retaining the proof requirements.

**Live outcome:** [all five fresh calls returned valid grades](evidence/grader-abstention-2026-10-14/live-results.md). The appropriate refusal used `non_factual` with no proof and routed to `abstain`. All five routing decisions matched the frozen sets, but only three matched every grading axis; coverage and uncertainty each missed one expectation. The predeclared smoke gate failed. V2 remains an explicit candidate, existing workers stay v1, and activation remains closed.

## Contract

Call `gradeClaimSupport` with the explicit input selector `graderVersion: 'claim-support-v2-abstention'`. Omitting it preserves `claim-support-v1`; existing automatic workers retain their original version while this candidate is tested. Request, prompt and receipt hashes bind the selected version. Receipts cannot cross replay between versions.

- A pure refusal to supply a product value is `non_factual` with an empty proof list. This does not certify that refusal was appropriate.
- If the requested fact is absent, the expected result is an appropriate abstention. If it is present, refusing is incomplete and an unnecessary abstention requiring repair.
- A refusal sharing a unit with a product assertion must assess the complete unit. An unsupported added fact cannot hide behind the refusal or its `insufficient_evidence` status.
- `supported` still requires a literal supporting proof quote; `contradicted` requires a literal contrary quote. No invalid output is automatically converted to a valid abstention.
- Answerability concerns the original question. Uncertainty handling concerns confidence in the original answer rather than the grader's confidence.

V1 request bytes and receipt validation remain unchanged, including rejection of the earlier failed abstention. Exact historical calibration CLI replay additionally requires the original code checkout because execution manifests bind source hashes; current code does not waive those bindings. The original v3 report remains immutable and can be replayed from its recorded implementation commit.

## Fresh finite smoke test

Five new fictional source packets are distinct from the exposed v3 development cases and private product holdouts. They are **five unpaired constructed cases**, with AI-authored references and independent AI source-consistency review. They are not a human benchmark or production-calibration set.

| Case | Expected unit / disposition |
| --- | --- |
| Halven lantern: no supplied IP rating | `non_factual` / appropriate `abstain` |
| Morven board: refuses the explicitly supplied thickness | `non_factual` / `repair` for unnecessary abstention |
| Kelmor speaker: missing warranty plus invented battery duration in the same unit | `unsupported` / `abstain` or `uncertain`, never pass |
| Peldin notebook: correct cited page count | `supported` / `pass` |
| Varnel spoon: asserted volume explicitly contradicted by the source | `contradicted` / `repair` |

Kelmor's source-correctness labels permit `consistent_with_sources` or `uncertain`: absent evidence establishes unsupportedness, not physical falsehood. Its support and overconfidence labels remain fixed. Existing routing makes the allowed disposition `abstain` or `uncertain`. These alternatives are declared before execution.

**Predeclared smoke gate:** every frozen case must produce a valid grade and match all its frozen reference axes, with zero raw passes for flawed answers. Invalid/unknown outcomes stop later calls; unattempted cases cannot count as successes. Passing this focused gate does not qualify general calibration, live policy activation or an answer-quality gain.

| Local planning bound | Value |
| --- | ---: |
| Starting shared attempts / pending | 91 / 0 |
| New calls / allowance per attempt | At most 5 / $0.10 |
| Maximum added planning allowance | $0.50 |
| Absolute shared attempt ceiling | 96 |
| Maximum cumulative reserved allowance | $9.60 |
| Existing prior-spend adjustment | $0.200281 |
| Maximum combined local planning usage | **$9.800281**, within the existing $10 plan |

These allowances are not settled charges or a provider-enforced cap. The new manifest fingerprints **all 91 prior rows**. It reuses the shared ledger, exclusive intent, exact request guard, stopped-worker checks, single active slot, append-only checkpoints and no-retry rules from the [runner protocol](grader-calibration-pilot.md). There is no generation, repair, search, proposal or policy activation call.

After merging the reviewed implementation, freeze a new plan:

```sh
npm run grader:calibration -- --prepare \
  --protocol abstention-v2-five \
  --implementation-commit <reviewed-merged-code-commit> \
  --out /absolute/path/to/a-new-plan.json
npm run grader:calibration -- --verify --plan /absolute/path/to/a-new-plan.json
```

The parent must source-check and acknowledge that exact plan. The existing live opt-ins and explicit ledger/cap settings still apply; only `--execute` can dispatch. The absolute call limit remains 96. The old ten-case protocol cannot prepare against the new 91-row starting state and is not resumed. Reports retain all five planned slots and distinguish appropriate abstention, raw pass, per-axis reference agreement, invalid/unknown outcomes and token usage from valid grades. Any rejected response's saved raw token usage must also be included in the final accounting audit.

Offline verification uses isolated synthetic transport and no credentials:

```sh
node --import tsx --test server/claim-support*.test.ts server/grader-calibration*.test.ts
npm test
npm run build
```

The implementation cleared exact-commit CI and bot review in [PR #40](https://github.com/jayeshsuyal/ablatrix/pull/40). The [frozen plan](evidence/grader-abstention-2026-10-14/frozen-plan-v1.json) and [source review](evidence/grader-abstention-2026-10-14/source-review-v1.json) were published before dispatch. The live test is complete at 96 shared attempts with zero pending; no further call is authorized by this exhausted five-call scope. Live learned-policy activation remains closed.
