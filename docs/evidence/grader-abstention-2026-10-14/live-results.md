# Abstention-aware grader v2 — fresh live smoke test

**Five real calls completed with five valid grades. The appropriate-abstention proof regression behaved as intended. The full predeclared smoke gate failed: 3/5 cases matched every frozen grading axis.**

The existing Sapiom Router returned model identity `gpt-5.6-luna`. The grader explicitly used `claim-support-v2-abstention` on five new, unpaired fictional source packets. Expected axes and permitted uncertainty were published before dispatch. References are AI-authored and source-checked by AI; they are not human gold or external truth labels.

## Observed results

| Fresh case | Expected behavior | Live grade | Frozen-axis result |
| --- | --- | --- | --- |
| Halven: missing IP rating, pure refusal | `non_factual`, empty proof, appropriate `abstain` | Exactly that | **Match** |
| Peldin: correct cited page count | Supported factual `pass` | Exactly that | **Match** |
| Morven: refuses an explicitly supplied thickness | Unnecessary abstention, incomplete coverage, `repair` | Correct repair and unnecessary-abstention label; coverage incorrectly `complete` | **Disagreement: coverage** |
| Kelmor: missing warranty plus invented battery duration in the same unit | Whole unit `unsupported`, overconfident; `abstain` or `uncertain` | Unsupported and abstain; uncertainty incorrectly `appropriate` | **Disagreement: uncertainty** |
| Varnel: 15 mL claim conflicts with the supplied 5 mL value | Contradicted, overconfident, `repair` | Exactly that | **Match** |

All **5/5 routing dispositions** and **5/5 unit classifications** fall within the frozen references. Coverage and uncertainty each match **4/5** cases; full-axis agreement is **3/5**. None of the **three assessed flawed answers** received a raw pass. The mixed refusal's unsupported assertion remained factual rather than receiving a blanket `non_factual` exemption.

The gate required **all five valid grades, all five complete reference matches and zero flawed raw passes**. Its all-reference-axes condition failed. `complete=true` in the saved report means execution finished; it does not mean the smoke gate passed. The report's generic `rejected` status describes non-pass routing, including an appropriate `abstain`; the justified Halven abstention is a correct result, not a quality rejection.

No labels were changed after observing outputs. V2 remains an explicit candidate; existing automatic workers retain v1, and live learned-policy activation remains closed. The five new examples are not paired with old v1 grades, so **no general improvement, calibrated error rate or answer-quality gain is established**.

## Execution and accounting

| Check | Recorded observation |
| --- | --- |
| Planned / dispatched / valid grades | **5 / 5 / 5** |
| Invalid / unknown / unattempted | **0 / 0 / 0** |
| Raw dispositions | **1 pass / 2 repair / 2 abstain** |
| Shared ledger before / after | **91 / 96** attempts; zero pending and active owners after close |
| New / cumulative reserved allowance | **$0.50 / $9.60** |
| Including existing prior-spend adjustment | **$9.800281**, within the $10 local plan |
| Provider-reported usage, all five responses | **6,261 input / 775 output tokens** |
| Historical protection | All **122** protected artifacts and all **91** prior receipt rows unchanged |

The existing absolute call ceiling is reached. No retry or further dispatch occurred. Planning allowances are **not settled provider charges or a provider-enforced cap**. Token totals cover all five saved responses; billed charges are not known. This run performed no answer generation, revision, search, training, proposal or activation call.

## Inspect and reproduce

- [Frozen inputs, references, exact requests, criteria and bounds](frozen-plan-v1.json), published in [commit 1af3c8e before dispatch](https://github.com/jayeshsuyal/ablatrix/commit/1af3c8e).
- [Exact-plan AI source review](source-review-v1.json), [offline qualification](offline-qualification-v1.json), [immutable full report and receipts](live-report-v1.json), and [post-run gate/accounting audit](post-run-audit-v1.json).
- [Versioned grader contract and protocol](../../grader-abstention-v2.md), reviewed and merged in [PR #40](https://github.com/jayeshsuyal/ablatrix/pull/40).

On the originating checkout, exact read-only replay checks current committed code, the plan, canonical private claim, private checkpoint and trusted shared-ledger receipts:

```sh
npm run grader:calibration -- --replay \
  --plan "$PWD/docs/evidence/grader-abstention-2026-10-14/frozen-plan-v1.json" \
  --checkpoint "$PWD/.data/grader-calibration/abstention-v2-smoke-v1.jsonl" \
  --report "$PWD/docs/evidence/grader-abstention-2026-10-14/live-report-v1.json"
```

Replay passed with zero new provider calls. Independent AI review reconstructed the saved journal/report, source-review bindings and all observed disagreements. Public receipts are local saved records, not independently signed provider billing attestations.

On another checkout, run the isolated mechanics regressions without credentials or the private ledger:

```sh
npm ci
node --import tsx --test server/claim-support*.test.ts server/grader-calibration*.test.ts
```

The remaining development issues are completeness grading for an unjustified refusal and confidence grading across mixed answer units. Any next grader version needs a new frozen protocol and separately authorized live scope; this report supplies no rollout or activation permission.
