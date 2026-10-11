# Source-ID comparison: live execution

The approved [version 2 plan](execution-plan-v2.json) stopped after **8 of 24 planned attempts**: seven accepted outputs, one rejected output and 16 unattempted calls. Two of eight planned revision pairs completed. No reduced cohort was imported into blind review, and no human quality judgments or policy promotion followed.

## Recorded results

| Measure | Observed |
| --- | ---: |
| Planned products / revision pairs | 8 |
| Maximum planned calls | 24 |
| Reserved attempts / network dispatches | 8 / 8 |
| Accepted original/revision outputs | 7 |
| Rejected output | 1 |
| Calls not attempted | 16 |
| Completed pairs / planned pairs | 2 / 8 |
| Exact source-body citation checks on accepted outputs | 22 / 22 |
| Source-checked human judgments | 0 |
| Shared ledger before / after | 73 / 81 |
| Additional local planning allowance | $0.80 |
| Actual settled charges | Unavailable |

All eight HTTP responses produced completed transport receipts. The eighth receipt also records `output_validation`: the response was received, but the answer failed citation validation. A completed transport receipt must not be counted as an accepted answer.

The accepted outputs comprise three `answered` and four `insufficient_evidence` statuses. These are model statuses, not judgments of correctness. All eight transport receipts report token usage, totaling 15,464 input and 1,308 output tokens. Counts include the rejected response and do not establish billed cost.

## Stop reason

The failed revision selected four citation IDs. Three were offered; one omitted the last character of an offered ID:

```text
Offered:  src_d6dec31ee5a0006a8e2e684a
Returned: src_d6dec31ee5a0006a8e2e684
```

The server rejected the unknown ID rather than guessing its intended source. No retry, ID repair, replacement product, new critique or web call followed. The remaining 16 planned steps retain their unattempted state. Successful answer text remains private; no human quality judgments have been recorded. The published dispatch order and stop point make the failed arm inferable.

The next mechanical change should constrain the response schema to the IDs actually offered in each request, with a regression using this malformed selection. That would require a newly qualified interface/manifest before another paid run; it would not change this experiment's outcome or prove answer quality.

## Interpretation and provenance

The server reconstructed 22 accepted citations from literal supplied source bodies. This establishes exact source matching for those accepted outputs. It does not establish claim support, factual correctness, human-reviewed quality or improvement over the baseline. The frozen retrieval limitations described in [preparation](preparation.md) remain applicable. Two completed pairs cannot replace the planned eight-pair denominator.

The user approved the proposed live test after the explicit 24-call, $2.40 planning allowance and ceiling-97 proposal. The immutable preparation manifest still records `paidExecutionAuthorized: false`, reflecting its state when written. The private execution record binds operator approval to plan SHA256 `ce5c3d288781218dcf67e72ac77cbacb8c160e19a40384eaa2bf5d1722e489ee`.

Raw private result SHA256: `b7dfbb0ac2d3b32b3051482a1a472d3022902ff73166fe32aec1afcd225f9475`. Its request/response records are retained locally; the [public aggregate summary](live-summary.json) excludes answer text and arm associations. Exact request, catalog, instruction and receipt identities remain bound to the published plan.

The runner verified that all preceding 73 receipts and the existing review tables were unchanged. Localhost was restored with live generation, external investigation and Langfuse disabled. The underlying changes are merged through [PR #25](https://github.com/jayeshsuyal/ablatrix/pull/25), [PR #26](https://github.com/jayeshsuyal/ablatrix/pull/26) and [PR #27](https://github.com/jayeshsuyal/ablatrix/pull/27).
