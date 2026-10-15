# Completeness and confidence grader v3 — live smoke result

**Six real grading calls returned six valid grades; all six matched every frozen reference axis. The predeclared development smoke gate passed, with zero raw passes for the three flawed answers.**

The Sapiom Router returned model identity `gpt-5.6-luna` for the explicit `claim-support-v3-coverage-confidence` grader. Six new unpaired fictional packets cover the prior completeness/confidence failure patterns and positive controls. Worked rubric examples teach those patterns with different products and values: this is a **guided development smoke**, not held-out qualification. References are AI-authored and independently AI source-checked, not human gold or external truth.

## Observed results

| Frozen case, in execution order | Live grade | Full frozen-axis result |
| --- | --- | --- |
| Ubrin: missing country, pure refusal | `non_factual`, empty proof, complete, appropriate; `abstain` | Match |
| Lextar: width supplied, requested available height omitted | `supported`, incomplete, appropriate; `repair` | Match |
| Berqen: missing load refusal plus unsupported dishwasher assertion | `unsupported`, complete, overconfident; `abstain` | Match |
| Teskir: cited length plus explicitly unknown unrequested washability | `supported`, complete, appropriate; `pass` | Match |
| Zorvik: refuses explicitly supplied mass | `non_factual`, incomplete, unnecessary abstention; `repair` | Match |
| Delsun: complete cited material answer | `supported`, complete, appropriate; `pass` | Match |

Every axis—unit support, question coverage, answerability, source correctness and uncertainty handling—and each routing disposition matched the predeclared acceptable set on **6/6** cases. Berqen used the already permitted `consistent_with_sources` / `abstain` branch; missing support does not establish physical falsehood. No reference labels or acceptable sets changed after dispatch.

The grader explicitly identified the omitted **25 cm height**, the unnecessarily withheld **180 g mass**, and the unsupported dishwasher assertion despite its neighboring sensible refusal. It also accepted an honest qualifier rather than treating it as an asserted capability. Literal proofs for supported units occur in the frozen sources and match the answer citations. Quote membership checks provenance; semantic support remains an AI estimate against supplied sources, not independently verified real-world correctness or human-reviewed quality.

The gate required **all six valid grades, all six full reference matches, and zero flawed raw passes**; all conditions passed. Report `complete=true` means execution finished and is separate from that gate calculation. Generic slot status `rejected` means non-pass routing, including a correct `abstain`; Ubrin is an acceptable refusal, not a quality failure.

The [earlier v2 result](../grader-abstention-2026-10-14/live-results.md) remains **3/5** full-axis agreement and a failed gate. These different cases are not a paired v2/v3 experiment, so the comparison establishes no measured general improvement, calibrated error rate or product-answer quality gain. V3 remains opt-in; existing automatic workers retain v1 and live learned-policy activation stays closed.

## Execution and accounting

| Check | Observation |
| --- | --- |
| Planned / dispatched / valid | **6 / 6 / 6** |
| Invalid / unknown / unattempted | **0 / 0 / 0** |
| Raw dispositions | **2 pass / 2 repair / 2 abstain** |
| Flawed raw passes | **0 / 3** |
| Shared attempts before / after | **96 / 102**, zero pending or active owners after close |
| Added / cumulative reserved allowance | **$0.60 / $10.20** |
| Including existing $0.200281 prior-spend adjustment | **$10.400281**, within the approved $11 cumulative local plan |
| Provider-reported usage, all six responses | **10,884 input / 994 output tokens** |
| Historical protection | All **128** protected artifacts and **96** prior receipt rows unchanged; all four frozen pre-dispatch artifacts unchanged |

The six-call scope and 102-attempt ceiling are now exhausted. There were **no retries**, answer generations, repairs, searches, training, proposals, rollouts or policy activations. The ledger contains six completed reservations matching the exact plan run IDs. Allowances are **not settled charges or a provider-enforced cap**; billed charges remain unknown.

The saved report records **33,847 ms** summed per-slot wall time, including local boundary checks, and separate fetch/complete-body durations. This is execution timing, not a paired latency or cost reduction measurement.

## Inspect and reproduce

- [Exact inputs, references, requests and criteria](frozen-plan-v1.json), published in [commit 36c3504 before dispatch](https://github.com/jayeshsuyal/ablatrix/commit/36c35046f6cc8dd6c79ef6686267d43347d444ee).
- [Completed independent AI source review](source-review-v1.json), [offline verification](offline-qualification-v1.json), and [explicit user authorization](execution-authorization-v1.json), published in [commit fc8ad29 before dispatch](https://github.com/jayeshsuyal/ablatrix/commit/fc8ad291d548523e27fc653f56ed958a326f691a).
- [Immutable full report and six receipts](live-report-v1.json), [gate, history and accounting audit](post-run-audit-v1.json), and [versioned contract](../../grader-coverage-confidence-v3.md).
- Implementation merged in [PR #42](https://github.com/jayeshsuyal/ablatrix/pull/42), after exact-head CI and completed bot review.

The frozen plan/report retain their pending-at-construction reference label and generic review wording. The linked source review records completed AI source checking separately. The offline record's pending financial approval is likewise a preparation-time snapshot; the later authorization records the user's explicit approval. None is rewritten after the outcome.

On the originating checkout, this read-only command rechecks code, plan, private claim/checkpoint and trusted shared-ledger receipts without provider calls:

```sh
npm run grader:calibration -- --replay \
  --plan "$PWD/docs/evidence/grader-coverage-confidence-2026-10-15/frozen-plan-v1.json" \
  --checkpoint "$PWD/.data/grader-calibration/coverage-confidence-v3-smoke-v1.jsonl" \
  --report "$PWD/docs/evidence/grader-coverage-confidence-2026-10-15/live-report-v1.json"
```

Replay passed. Two independent AI audits checked source/reference agreement, exact bindings, checkpoint consistency, token totals and qualification flags. Public receipts are saved local records, not independently signed provider billing attestations. A different checkout needs the recorded implementation for exact historical CLI replay; no hash binding is waived.

For isolated mechanics verification without credentials or private data:

```sh
npm ci
node --import tsx --test server/claim-support*.test.ts server/grader-calibration*.test.ts
```

The next evidence step is broader separately frozen qualification, including unseen failure patterns. This six-case result grants no automatic-worker rollout or policy-activation permission.
