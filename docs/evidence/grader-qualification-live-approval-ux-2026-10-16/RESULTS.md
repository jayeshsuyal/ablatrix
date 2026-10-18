# Live v3 qualification result

**Failed after 20 live grading calls. Production activation remains closed.**

The frozen critical-axis stop rule fired on primary case 20. Independent read-only replay matched the saved report and qualification record. All 20 attempted calls returned valid HTTP 200 grading responses; 72 planned calls were unattempted.

| Measure | Observed |
| --- | ---: |
| Primary cases evaluated | 20 / 80 planned |
| Critical-axis agreement | 19 / 20 evaluated |
| Full-axis agreement | 18 / 20 evaluated |
| Flawed answers falsely passed | 0 / 15 evaluated (60 planned) |
| Acceptable answers routed correctly | 5 / 5 evaluated (20 planned) |
| Repeat checks | 0 / 12 planned |
| Added reserved planning allowance | $2.00 / $9.20 approved maximum |

These are local planning allowances, not settled provider charges. The shared ledger now contains 122 attempts, zero pending and $12.20 reserved, plus the unchanged $0.200281 prior adjustment. All original 102 rows are unchanged.

## What disagreed

- **Case 20 — product scope:** the grader noticed that the quoted capability applied to a different variant, but returned `uncertain` support instead of the reference’s required `unsupported`. This critical disagreement stopped the run.
- **Case 10 — citation versus correctness:** the answer matched a fact in the complete source body but cited an irrelevant sentence. The grader marked factual correctness and routing uncertain; the reference required consistent-with-sources plus citation repair.

The [confirmation UX repair](https://github.com/jayeshsuyal/ablatrix/pull/47) was reviewed, CI passed and it was merged before this run. The native challenge was prefilled; the operator still explicitly approved the displayed exact plan. Raw execution plans, authorization, receipts and audit files remain private.

## Next

Clarify these two rubric distinctions using the seen cases as development regressions, then freeze a new independently reviewed qualification cohort. The consumed cohort cannot be resumed or reused as fresh qualification after tuning. No additional paid calls or activation are authorized by this result.

This is agreement with AI-reviewed references for constructed fictional packets. It is not human gold, external truth or measured real-user answer improvement. Partial results do not establish full-benchmark rates.
