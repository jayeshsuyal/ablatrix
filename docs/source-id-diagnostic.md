# Six-call citation delivery diagnostic

[PR #29](https://github.com/jayeshsuyal/ablatrix/pull/29) merged the explicitly selected `source_ids_v2` interface. This diagnostic checked its request-specific citation enums and server resolver. The user approved the six-call/$0.60 scope after the proposal. The execution prerequisites were a frozen plan, qualified merged runner and passing safety gates. The operator bound that scope approval to the exact executed plan hash.

## Fixed scope

The three cases reuse the public [stopped comparison's source manifest](evidence/source-id-correction-2026-10-10/execution-plan-v2.json). Their questions, original answer policy, five ordered retrieved sources, original customer questions and prewritten AI-authored critique remain fixed. Earlier generated answers are not used. The plan specified a new original followed by one baseline revision per case; the stopped result records which steps completed.

| Case | Diagnostic target | Interpretation limit |
| --- | --- | --- |
| Q10021 | The source whose ID previously lost its final character | The target must actually be selected to exercise that selection; merely offering it is insufficient. |
| Q12820 | A complete 289-character structured package-dimensions body | Normalized/raw dimensions disagree and retrieval omits item dimensions; abstention may be appropriate. |
| Q8746 | Customer answers with original questions naming other laptop models | The questions establish source scope, not factual proof of compatibility with the customer's model. |

These products have already been exposed. Their historical input labels are retained for provenance; this is a mechanical diagnostic, not fresh validation or an answer-policy ablation. There is no candidate policy arm, source discovery, model change or policy promotion.

## Bounds and saved records

The maximum is six attempts: original then baseline revision for Q10021, Q12820 and Q8746, in that order. The shared local ledger starts at 81 and cannot exceed 87. Each attempt reserves a $0.10 local planning allowance, for at most $0.60 added allowance under the existing $10 planning cap. Allowances are not settled provider charges or a provider-enforced ceiling.

The manifest binds source and case-audit hashes, code and qualification fingerprints, prompt identities, original request hashes, ordered source catalogs and response-schema hashes. Revision prose depends on its newly generated original; the fixed derivation rule constructs and hashes the actual revision request before dispatch. Each receipt must match the recorded interface, option-set and schema identities.

Execution must hold the shared provider ledger and preserve earlier receipts and review tables. Before creating output or a provider, it checks configured/default port listeners, other processes holding the exact shared budget/review files, app/loop PID locks, provider leases and queued/running review jobs. The measured stopped state is retained in private results. These checks repeat before each reservation, immediately before dispatch and after responses, including saved-history and own-reservation/lease checks. An observed restart or state change stops further dispatches. This does not prevent an external process starting during an in-flight request or undo a spent call. Results are written to a new private file. There is no resume, retry, ID repair, replacement case, extra call, web operation or reduced-cohort import. The first dispatch, response, identity, citation or persistence failure stops the run; remaining steps stay unattempted.

## What completion means

Accepted output and citation coverage are separate. An `insufficient_evidence` answer may legitimately select no citation. That response can pass output validation while leaving its ID-selection path unexercised. Report selected IDs and exact full-body membership per request, and whether each diagnostic target was actually selected. Missing target or request coverage remains inconclusive; do not extend the run automatically.

Even six accepted outputs with observed selection establish only behavior in this diagnostic. They do not prove Sapiom Router enforces constrained decoding, estimate general failure probability, establish claim support or answer correctness, or demonstrate human-reviewed improvement. A later quality comparison needs a separately frozen fresh cohort and independent blind source review.

## Preparation and execution status

The approved version 3 plan was executed once after PR #30 merged. The [live report](evidence/source-id-diagnostic-2026-10-11/live-report.md) records five attempts, four accepted outputs, 12/12 exact citations, one response-shape rejection and one unattempted revision. Ledger 81→86; $0.50 added planning allowance; no retry or quality claim. Localhost was restored with paid/web/telemetry modes disabled.

The [supersession record](evidence/source-id-diagnostic-2026-10-11/plan-supersession-v3.md) preserves the unused earlier manifests and explains both bot-found shutdown repairs.

The [case audit](evidence/source-id-diagnostic-2026-10-11/case-audit.json), [offline qualification](evidence/source-id-diagnostic-2026-10-11/offline-qualification-v3.json) and [preparation record](evidence/source-id-diagnostic-2026-10-11/preparation-v3.json) bind the code and sources. The [frozen plan](evidence/source-id-diagnostic-2026-10-11/execution-plan-v3.json) has canonical SHA-256 `5239294ddec363335de2b176afa5df58ce16204ebbafeb31a976001c881a7164` and uses implementation commit `9cba21c6ecf6cb700ac01a990a65576f0b83b293`. Its `paidExecutionAuthorized: false` describes preparation; the later execution record binds the operator's scope approval to this exact hash.

Reproduce preparation to a new file:

```sh
node --import tsx scripts/source-id-diagnostic.ts --prepare \
  --source-plan docs/evidence/source-id-correction-2026-10-10/execution-plan-v2.json \
  --qualification docs/evidence/source-id-diagnostic-2026-10-11/offline-qualification-v3.json \
  --case-audit docs/evidence/source-id-diagnostic-2026-10-11/case-audit.json \
  --implementation-commit 9cba21c6ecf6cb700ac01a990a65576f0b83b293 \
  --out /tmp/new-source-id-diagnostic-plan.json
```

The creation timestamp changes a regenerated plan hash. Execution uses the published immutable manifest, never a silently regenerated plan. Preparation makes no provider calls; the previous stopped experiments remain unchanged.
