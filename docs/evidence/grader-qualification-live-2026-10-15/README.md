# Proposed v3 live qualification run

**Code merged and reviewed; paid execution is not approved or started.**

The [adapter PR](https://github.com/jayeshsuyal/ablatrix/pull/45) is merged. [Bot review](https://github.com/jayeshsuyal/ablatrix/pull/45#issuecomment-6202649353) reported no major issues on `255e53ff722fe68799eac4f9981a333554a1eadf`. [CI](https://github.com/jayeshsuyal/ablatrix/actions/runs/38809716686) passed 503 server tests, 3 CLI guard tests, 41 browser tests, the build and original seal reproduction.

## Frozen scope

[Public budget and scope summary](budget-summary-v1.json). Full executable plan SHA-256: `12b1e3057e974f222248ff7c1ca6938c6ef80e3e832aee0560ff075603ea305f`.

The full executable plan and preparation audit remain local because they bind private host paths and a ledger fingerprint. They are excluded from Git; this public summary is not executable or financial approval.

The plan binds 24 reviewed code files, the unchanged sealed v3 benchmark and source review, exact requests/order/run IDs, all 102 prior ledger rows and early-stop rules. It permits **80 primary grading calls plus 12 fixed repeats**, with no retries or resume. Generation, repairs, search, training and policy activation are outside this plan.

| Budget item | Maximum |
| --- | ---: |
| New grading calls | 92 |
| Local allowance per call | $0.10 |
| Added planning allowance | $9.20 |
| Cumulative attempts | 194 |
| Cumulative reserved allowance | $19.40 |
| Existing prior-spend adjustment | $0.200281 |
| Combined planning usage | $19.600281 |
| Proposed cumulative local cap | $20.00 |

These are local planning allowances, **not settled charges or a provider-enforced cap**. Early stopping may use fewer calls. The app retains its exhausted 102-call / $11 scope; a later approved CLI run uses process-local limits.

## Reproduce offline verification

On the original operator host, with the private execution plan, full Git history, exact reviewed code and unchanged canonical local stores:

```sh
node --import tsx scripts/grader-qualification-live.ts --verify \
  --plan "$PWD/docs/evidence/grader-qualification-live-2026-10-15/execution-plan-v1.json"
```

This reads no credential and constructs no provider. Preparation verified the plan and the unchanged starting ledger: 102 attempts, zero pending, $10.20 reserved. A completed raw-hash check found all 144 historical artifacts unchanged; later iCloud offloading is recorded transparently in the private audit.

## After approval

The operator approves this exact plan and completes native confirmation through the [reviewed launcher workflow](../../grader-qualification-live.md). The adapter reserves each call, journals every attempt, stops on frozen failure rules, then independently replays actual shared-ledger receipts before publishing a separate qualification record.

Qualification requires all 92 valid outcomes, zero flawed primary passes, 80/80 critical-axis matches, 20/20 acceptable dispositions, at least 76/80 full-axis matches and 12/12 stable repeats. A passing prefix never qualifies.

**No live qualification result exists yet.** A future pass covers constructed single-unit source-support shadow evaluation. References have independent AI source-consistency review, not human gold. Citation matching, reference agreement, answer correctness and human-reviewed quality remain distinct; production activation and answer-improvement claims stay closed.
