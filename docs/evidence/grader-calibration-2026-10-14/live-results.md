# Live grader-discrimination pilot — October 14, 2026

**Partial result: five real Router calls, four valid grades, one invalid grade, five unattempted cases. Grader qualification and live policy activation remain closed.**

The existing `gradeClaimSupport` operation assessed constructed answers against fictional source packets through Sapiom, returning model identity `gpt-5.6-luna`. This run generated no new product answers or policy updates. Its ten cases form five correlated good/flawed family pairs; they are not ten independent products or a human benchmark.

## What happened

| Frozen slot | Constructed answer | Observed result | Full frozen-axis match |
| --- | --- | --- | --- |
| 1 | Taren: adds adapter-free fit using another model's customer answer | `uncertain`; no approval | No: support, answerability and uncertainty labels differ |
| 2 | Doran: says both customers reported no leakage | `repair`; contradiction identified | No: uncertainty label differs |
| 3 | Doran: accurately attributes the different reports | `pass` | Yes |
| 4 | Orin: supplies both requested materials | `pass` | Yes |
| 5 | Aven: appropriately withholds an absent temperature rating | **Invalid output**: `supported` unit with no supporting proof quote | Not scored |
| 6–10 | Aven invented rating; Orin omission; Rivel correct capacity and unsupported extra claim; Taren exact fit | **Unattempted** after slot 5 failed validation | Not scored |

The fifth response gave a sensible abstention rationale, but violated the unchanged output contract. Validation rejected it and stopped later dispatch. The failed output, all ten planned slots and the five consumed reservations are retained. No retry, replacement case, reference relabeling or policy activation occurred.

All four valid dispositions fall within the acceptable sets frozen before execution. **Two of four** valid grades match every frozen reference axis. No flawed answer was passed among the **two assessed flawed answers**; the other **three flawed answers were unattempted**. The report retains its frozen five-flawed-case denominator, which must not be interpreted as five successfully evaluated negatives. Only **one of five family pairs** completed. The correct-abstention grade was not validated.

These observations identify grader instruction and rubric weaknesses. They do not establish broad calibration, external truth, answer correctness, user preference, learning or answer-quality improvement. References remain AI-authored; the separately saved AI source-consistency review does not create human gold judgments.

## Execution and accounting

| Check | Recorded observation |
| --- | --- |
| Planned / actual transport calls | 10 / **5**, all with observed HTTP 200 responses |
| Valid / invalid / unattempted grades | **4 / 1 / 5** |
| Shared ledger before / after | **86 / 91** attempts; zero pending and zero active owners after close |
| Added / cumulative reserved planning allowance | **$0.50 / $9.10** |
| With existing prior-spend adjustment | **$9.300281**, within the $10 local plan |
| Provider-reported tokens, all five responses | **5,169 input / 926 output** |
| Valid-grade-only usage in immutable report | **4,241 input / 799 output** across four valid grades |
| Historical protection | All **116** protected artifacts and the original 86 receipt rows unchanged |

Planning allowances are **not settled provider charges or a provider-enforced cap**. The rejected fifth response also reported token usage. The additive audit includes it; the immutable report's usage aggregate covers only the four valid grades. No billed-dollar reduction is claimed.

## Inspect and reproduce

- [Frozen v3 inputs, references, requests, bounds and code hashes](frozen-plan-v3.json), published in [commit 2080d30 before dispatch](https://github.com/jayeshsuyal/ablatrix/commit/2080d30).
- [Exact-plan AI source-consistency review](source-review-v3.json) and [offline qualification](offline-qualification-v3.json).
- [Immutable full report and bound receipts](live-report-v3.json), plus [post-run accounting and integrity audit](post-run-audit-v3.json).
- [Runner and execution protocol](../../grader-calibration-pilot.md); implementation merged in [PR #37](https://github.com/jayeshsuyal/ablatrix/pull/37), OS inspection follow-up in [PR #38](https://github.com/jayeshsuyal/ablatrix/pull/38).

On the originating checkout, verify the public plan from the repository root without credentials or network access:

```sh
npm ci
npm run grader:calibration -- --verify \
  --plan docs/evidence/grader-calibration-2026-10-14/frozen-plan-v3.json
```

Plan verification also checks the fixed caller scope, including the existing local ledger path. On a separate checkout, the public case/reference/request hashes and full report are inspectable, and isolated mechanics tests run without that private ledger:

```sh
node --import tsx --test server/grader-calibration*.test.ts
```

On the originating checkout, exact read-only replay additionally verifies the private checkpoint, canonical claim and current trusted ledger receipts:

```sh
npm run grader:calibration -- --replay \
  --plan "$PWD/docs/evidence/grader-calibration-2026-10-14/frozen-plan-v3.json" \
  --checkpoint "$PWD/.data/grader-calibration/live-v3.jsonl" \
  --report "$PWD/docs/evidence/grader-calibration-2026-10-14/live-report-v3.json"
```

Replay passed after the run and made zero provider calls. Independent AI review reconstructed the journal/report and checked the frozen source-review bindings and counts. Public receipts are saved local records, not independently signed provider billing attestations. The earlier [v2 stop](live-report-v2.json) and [zero-dispatch reconciliation](zero-dispatch-reconciliation-v2.json) remain unchanged; v2 consumed no allowance and was not retried.

## Next qualification step

Use the saved failures as development examples: distinguish confidence in the original answer from confidence in the grader, and specify how an absence-of-information answer maps to `non_factual` rather than unsupported `supported` output. Preserve this protocol and its labels. Any revised grader needs a new version and a newly frozen, broader source-checked evaluation with predetermined reliability and false-approval gates before considering live learned-policy activation. This partial pilot supplies no activation threshold or quality-gain claim.
