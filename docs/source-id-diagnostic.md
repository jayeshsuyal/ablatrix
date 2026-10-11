# Six-call citation delivery diagnostic

[PR #29](https://github.com/jayeshsuyal/ablatrix/pull/29) merged the explicitly selected `source_ids_v2` interface. This diagnostic prepares a small live check of its request-specific citation enums and server resolver. The user approved the six-call/$0.60 scope after the proposal. Execution waits for a frozen plan, qualified merged runner and its safety gates; the operator records that scope approval against the exact plan hash.

## Fixed scope

The three cases reuse the public [stopped comparison's source manifest](evidence/source-id-correction-2026-10-10/execution-plan-v2.json). Their questions, original answer policy, five ordered retrieved sources, original customer questions and prewritten AI-authored critique remain fixed. Earlier generated answers are not used. Each case receives a new original answer followed by one baseline revision of that new answer.

| Case | Diagnostic target | Interpretation limit |
| --- | --- | --- |
| Q10021 | The source whose ID previously lost its final character | The target must actually be selected to exercise that selection; merely offering it is insufficient. |
| Q12820 | A complete 289-character structured package-dimensions body | Normalized/raw dimensions disagree and retrieval omits item dimensions; abstention may be appropriate. |
| Q8746 | Customer answers with original questions naming other laptop models | The questions establish source scope, not factual proof of compatibility with the customer's model. |

These products have already been exposed. Their historical input labels are retained for provenance; this is a mechanical diagnostic, not fresh validation or an answer-policy ablation. There is no candidate policy arm, source discovery, model change or policy promotion.

## Bounds and saved records

The maximum is six attempts: original then baseline revision for Q10021, Q12820 and Q8746, in that order. The shared local ledger starts at 81 and cannot exceed 87. Each attempt reserves a $0.10 local planning allowance, for at most $0.60 added allowance under the existing $10 planning cap. Allowances are not settled provider charges or a provider-enforced ceiling.

The manifest binds source and case-audit hashes, code and qualification fingerprints, prompt identities, original request hashes, ordered source catalogs and response-schema hashes. Revision prose depends on its newly generated original; the fixed derivation rule constructs and hashes the actual revision request before dispatch. Each receipt must match the recorded interface, option-set and schema identities.

Execution must hold the shared provider ledger, require the app and review workers to be stopped, and preserve earlier receipts and review tables. Results are written to a new private file. There is no resume, retry, ID repair, replacement case, extra call, web operation or reduced-cohort import. The first dispatch, response, identity, citation or persistence failure stops the run; remaining steps stay unattempted.

## What completion means

Accepted output and citation coverage are separate. An `insufficient_evidence` answer may legitimately select no citation. That response can pass output validation while leaving its ID-selection path unexercised. Report selected IDs and exact full-body membership per request, and whether each diagnostic target was actually selected. Missing target or request coverage remains inconclusive; do not extend the run automatically.

Even six accepted outputs with observed selection establish only behavior in this diagnostic. They do not prove Sapiom Router enforces constrained decoding, estimate general failure probability, establish claim support or answer correctness, or demonstrate human-reviewed improvement. A later quality comparison needs a separately frozen fresh cohort and independent blind source review.

## Preparation and execution status

The [case audit](evidence/source-id-diagnostic-2026-10-11/case-audit.json), [offline qualification](evidence/source-id-diagnostic-2026-10-11/offline-qualification.json) and [preparation record](evidence/source-id-diagnostic-2026-10-11/preparation.json) bind the code and sources. The [frozen plan](evidence/source-id-diagnostic-2026-10-11/execution-plan.json) has canonical SHA-256 `37fce24b69437b9152312bd563b86170161fb7c303aa77b08bded209928e02df` and uses implementation commit `f9b64b3f748f12a107e7a7d48d5b81b7012c78ef`. Its `paidExecutionAuthorized: false` describes preparation; the later execution record binds the operator's scope approval to this exact hash.

Reproduce preparation to a new file:

```sh
node --import tsx scripts/source-id-diagnostic.ts --prepare \
  --source-plan docs/evidence/source-id-correction-2026-10-10/execution-plan-v2.json \
  --qualification docs/evidence/source-id-diagnostic-2026-10-11/offline-qualification.json \
  --case-audit docs/evidence/source-id-diagnostic-2026-10-11/case-audit.json \
  --implementation-commit f9b64b3f748f12a107e7a7d48d5b81b7012c78ef \
  --out /tmp/new-source-id-diagnostic-plan.json
```

The creation timestamp changes a regenerated plan hash. Execution uses the published immutable manifest, never a silently regenerated plan. Preparation makes no provider calls; the previous stopped experiments remain unchanged.
