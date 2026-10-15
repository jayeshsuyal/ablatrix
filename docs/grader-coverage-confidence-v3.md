# Completeness and confidence grader v3

The [v2 live test](evidence/grader-abstention-2026-10-14/live-results.md) returned five valid grades but matched every frozen axis on only three cases. It called an unnecessary refusal complete and missed the overconfidence of an unsupported assertion beside a valid refusal. V3 adds an explicit rubric and worked development examples for those two failures.

**Live outcome:** [six real calls returned six valid grades and six complete frozen-axis matches](evidence/grader-coverage-confidence-2026-10-15/live-results.md). The predeclared development smoke gate passed. The previously missed completeness and confidence patterns behaved as expected on fresh constructed cases, alongside positive controls. This does not qualify general calibration or answer-quality gain. V3 stays opt-in, existing workers retain v1 and live policy activation stays closed.

Implementation merged in [PR #42](https://github.com/jayeshsuyal/ablatrix/pull/42), with successful CI and completed bot review. The [exact plan](evidence/grader-coverage-confidence-2026-10-15/frozen-plan-v1.json), [AI source review](evidence/grader-coverage-confidence-2026-10-15/source-review-v1.json) and [offline verification](evidence/grader-coverage-confidence-2026-10-15/offline-qualification-v1.json) were published before execution. After the old 96-call / $10 scope closed, the user [explicitly approved the six-call increase](evidence/grader-coverage-confidence-2026-10-15/execution-authorization-v1.json). This new scope is now exhausted at 102 shared attempts, with zero pending reservations.

## Contract

Select `graderVersion: 'claim-support-v3-coverage-confidence'` explicitly. Omitted selectors and existing workers retain v1. V1/v2 prompt bytes, proof validation, disposition routing and historical receipts remain unchanged; old invalid results remain invalid. Request and receipt hashes bind the selected version. Historical CLI replay still requires the original recorded code checkout.

- **Completeness:** supply every requested fact available in the supplied sources. A topical refusal or an omitted second requested detail is incomplete. Appropriately withholding an absent fact can be complete.
- **Confidence:** assess every original product assertion. A categorical unsupported addition is overconfident even beside an appropriate refusal. An explicit unknown qualifier does not assert that capability.
- **Independent axes:** a supported partial answer can be incomplete. Unsupported extra content does not erase a supported requested fact. Answerability concerns the original question; source correctness does not establish external physical truth.
- **Literal proof:** `supported` and `contradicted` still require exact source quotes. Matching checks quote provenance; semantic support remains an AI estimate. No output is silently repaired into a valid grade.

Worked examples teach these patterns using different fictional products and values from the test. This makes the test a **guided development smoke**, not held-out qualification.

## Fresh six-case plan

Six new fictional families contain three acceptable and three flawed answers. All references are AI-authored and independently AI source-checked, not human gold. Reference labels and family metadata stay outside model requests.

| Case | Expected coverage / confidence / disposition |
| --- | --- |
| Zorvik pouch: refuses supplied mass | incomplete / unnecessary abstention / repair |
| Lextar chest: supplies width, omits requested available height | incomplete / appropriate / repair |
| Berqen tray: refuses missing load rating but asserts unsupported dishwasher suitability | complete / overconfident / abstain or uncertain |
| Teskir mat: supplies length, explicitly marks unrequested washability unknown | complete / appropriate / pass |
| Delsun clip: supplies cited material | complete / appropriate / pass |
| Ubrin sleeve: appropriately refuses missing country of manufacture | complete / appropriate / abstain |

Berqen permits source-correctness `consistent_with_sources` or `uncertain`, because absent support does not establish physical falsehood. Its support is fixed to `unsupported` and confidence to `overconfident`; existing routing permits `abstain` or `uncertain`. These alternatives are declared before execution.

**Predeclared smoke gate:** all six frozen cases must yield valid grades matching every frozen axis, with zero raw passes for flawed answers. Invalid or unknown outcomes stop later dispatches; reports retain unattempted slots. Even a pass does not establish general calibration, answer-quality improvement or eligibility for live policy activation.

| Approved local planning bound, now consumed | Value |
| --- | ---: |
| Starting shared attempts / pending | 96 / 0 |
| New grading calls / allowance each | At most 6 / $0.10 |
| Maximum added allowance | $0.60 |
| Absolute shared attempt ceiling | 102 |
| Maximum cumulative reserved allowance | $10.20 |
| Existing prior-spend adjustment | $0.200281 |
| Maximum combined local planning usage | **$10.400281** |
| Approved cumulative planning cap | **$11** |

These are local allowances, not settled charges or a provider-enforced cap. The plan fingerprints all 96 prior rows and uses the [existing exclusive runner](grader-calibration-pilot.md), stopped-worker checks, exact request guards and append-only checkpoints. No retries, generation, repair, search, proposal, rollout or policy activation are included. Production `agents.run` stays closed.

The plan was frozen and verified after the reviewed implementation merged. Preparation is read-only with respect to provider calls; its original 96-row starting-state condition is intentionally no longer satisfied after execution:

```sh
npm run grader:calibration -- --prepare \
  --protocol coverage-confidence-v3-six \
  --implementation-commit <reviewed-merged-code-commit> \
  --out /absolute/path/to/a-new-plan.json
npm run grader:calibration -- --verify --plan /absolute/path/to/a-new-plan.json
```

The plan, source review and later explicit financial approval were published before dispatch. Execution required the exact plan acknowledgement, explicit live opt-ins, `ABLATRIX_LOOP_CALL_LIMIT=102` and `ABLATRIX_SPEND_CAP_USD=11`. These replaced the historical guide's 96/$10 settings only for this now-consumed protocol. The runner cannot resume or retry it. Verify saved receipts without new provider calls:

```sh
npm run grader:calibration -- --replay \
  --plan /absolute/path/to/the-frozen-plan.json \
  --checkpoint /absolute/path/to/the-private-checkpoint.jsonl \
  --report /absolute/path/to/the-saved-report.json
```

Offline verification: 59 focused tests; 433 server passes and one platform skip; production build and standalone CLI typecheck pass. Synthetic transports test mechanics, not model grading quality. The old v2 report reconstructs exactly and still records its failed 3/5 all-axis result. Implementation made no paid call; the separately authorized live smoke added exactly six grading calls and $0.60 local planning allowance. Exact receipt replay and independent results audits passed. No answer-quality gain is claimed.
