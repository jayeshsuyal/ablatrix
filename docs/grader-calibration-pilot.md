# Constructed grader-discrimination pilot

This pilot asks whether the **existing live claim-support grader** distinguishes source-grounded answers from small, inspectable flaws. It measures ten constructed answers in **five paired fictional product families**, not ten independent products. It does not measure external truth, human quality, general production calibration, model training or an answer-policy gain. Runtime assessments retain `calibration=not_measured` and `qualityClaimEligible=false`; no result unlocks live learned-policy activation.

## Frozen examples and reference review

| Fictional family | Source-limited good answer | Minimally changed flawed answer |
| --- | --- | --- |
| Rivel jug | Correct 750-milliliter capacity | Adds unsupported microwave safety inside the same answer unit |
| Taren insert | Attributes the exact VX-24 fit to its fit table | Transfers adapter-free fit from a customer answer about VX-60 |
| Orin lamp | Answers both base and shade materials | Omits the supplied shade material |
| Doran bottle | Attributes two different leakage reports | Claims both customers reported no leakage |
| Aven box | Appropriately withholds an absent temperature rating | Invents 100°C with a literal but irrelevant capacity citation |

There are **five good and five flawed answers**. Four good answers expect raw `pass`; the good missing-information answer expects an appropriate raw `abstain`. Correct abstention is reported separately from false rejection. Wrong-model and absent evidence are unsupported, not automatically contradicted. Narrow acceptable enum sets record defensible source-correctness uncertainty; desired prose reasons are never compared. Question coverage and unsafe raw approvals remain explicit.

All inputs are newly constructed fictional source packets. Product titles, questions, sources and answers contain no good/bad labels. Case identities derive from neutral inputs; the frozen manifest deterministically shuffles cases and assigns opaque run IDs. Family names, construction patterns, expected dispositions, axis references, rationales and source-review provenance remain outside the actual Router request. Every citation passes literal membership checks, including deliberately irrelevant citations. Literal membership, semantic support and completeness remain separate measurements.

References are **AI-authored constructed labels awaiting parent source review**, never human gold or independent real-world truth. The parent must inspect every source, answer, acceptable axis set and disposition before acknowledging the plan. That acknowledgement is recorded as a parent source-review/execution acknowledgement, separate from the original reference authorship. It does not create a human judgment or qualify broad calibration. Changing a case, label, code file or scope requires a newly frozen and acknowledged plan; preserve every prior artifact.

## Exact finite scope

The only permitted provider operation is `SapiomFeedbackProvider.gradeClaimSupport`, using its existing shared Router reservation ledger. There is no answer generation, proposal, repair, search, page read, retry, activation or production `agents.run` call.

| Bound | Value |
| --- | ---: |
| Starting shared attempts / pending | 86 / 0 |
| Starting reserved planning allowance | $8.60 |
| Maximum new grade operations | 10, one per frozen slot |
| Allowance per attempt / maximum addition | $0.10 / $1.00 |
| Absolute shared attempt ceiling | 96 |
| Cumulative reservation ceiling | $9.60 |
| Recorded prior-spend adjustment | $0.200281 |
| Maximum combined local planning usage | **$9.800281**, within the existing $10 plan |

These are local planning allowances, **not settled provider charges or a provider-enforced hard cap**. If starting count, pending state, allowance or historical receipt fingerprint differs, execution is blocked for parent review. The provider is constructed only after exact plan acknowledgement, current/committed/merged code, fixed grader/model/schema/request identity, explicit environment limits, existing-ledger schema and stopped-worker preflight pass. No database migration or new budget ledger is added. The shared ledger path is fixed to `../repo/.data/feedback-budget.sqlite`; all other application paths and the canonical private claim directory are frozen in caller scope.

The no-other-worker preflight checks default/configured listeners, shared database file owners, application ownership locks and queued/running/uncertain revision, automatic-check and policy-worker jobs. It repeats around reservations/transport, after the full body/grade/receipt operation, and before report publication after provider close. The parent handles stopping/draining the application and reconciliation; this build does not stop/restart the port-4194 server.

## Offline preparation and verification

`npm run grader:calibration` defaults to offline usage. Preparation, plan verification and checkpoint replay replace fetch with a network-deny function, never load `.env`, and never construct a credential-owning provider. Preparation reads aggregate shared ledger metadata and hashes historical receipt bytes internally without exposing their content.

```sh
npm run grader:calibration -- --prepare \
  --implementation-commit <exact-40-character-code-commit> \
  --out /absolute/path/to/a-new-frozen-plan.json
npm run grader:calibration -- --verify --plan /absolute/path/to/a-new-frozen-plan.json
node --import tsx --test server/grader-calibration*.test.ts
npm test
npm run build
```

The optional prepare flag `--scope <scope.json>` freezes explicit application database paths; the repository, existing shared ledger, initiating parent and execution authority remain fixed. The command will not overwrite an output. The code fingerprint covers the nine files listed in `CALIBRATION_CODE_FILES`, including the unchanged grader contract, provider, source-context helper and reused stopped-app checks. The source commit must contain those exact bytes; later code changes invalidate the plan. Live execution additionally requires that commit to be an ancestor of both `HEAD` and `github/main`.

## Parent-only live execution

**No paid call is made by this implementation.** The parent owns source review, bot review, fixes, merging, exact-plan qualification, application coordination and any later live execution. After those steps, the parent uses the project's existing credential configuration and an exact plan-SHA acknowledgement. The new CLI does not load or modify credentials/environment files.

The live process must explicitly set `ABLATRIX_GRADER_CALIBRATION_LIVE=1`, `ABLATRIX_LOOP_LIVE=1`, `ABLATRIX_LOOP_CALL_LIMIT=96`, the frozen `ABLATRIX_LOOP_BUDGET_DB`, `ABLATRIX_SPEND_CAP_USD=10`, `ABLATRIX_LOOP_PRIOR_SPEND_USD=0.200281` and `ABLATRIX_LOOP_ALLOWANCE_USD=0.10`. It also requires `ABLATRIX_REVISION_WEB=0`, `ABLATRIX_AUTOMATIC_CHECK_LIVE=0`, `ABLATRIX_ANSWER_POLICY_SHADOW_LIVE=0` and `ABLATRIX_LANGFUSE_ENABLED=0`. Use temporary process environment settings; app/live defaults and persisted `.env` remain unchanged.

```sh
npm run grader:calibration -- --execute \
  --plan /absolute/path/to/reviewed-frozen-plan.json \
  --acknowledged-plan-sha256 <exact-reviewed-plan-sha256> \
  --checkpoint /absolute/project/path/.data/grader-calibration/new-run.jsonl \
  --report /absolute/path/to/new-public-safe-report.json
```

The canonical plan claim and private checkpoint journal are exclusive-created, append-only, hash-chained, anchored separately and fsynced. Their paths and exact acknowledgement are recorded; private files use 0600 permissions. No command overwrites evidence or resumes into new dispatch. A started/unknown or malformed operation stops later calls, retaining all ten slots as completed/invalid/unknown/unattempted. A valid but semantically wrong grade is a finding and does not stop the remaining cases. Shared-provider ownership and the absolute ledger ceiling remain authoritative.

Read-only replay never creates a provider or dispatches:

```sh
npm run grader:calibration -- --replay \
  --plan /absolute/path/to/reviewed-frozen-plan.json \
  --checkpoint /absolute/project/path/.data/grader-calibration/new-run.jsonl \
  --report /absolute/path/to/new-public-safe-report.json
```

The verifier reconstructs results from frozen labels, exact current ledger receipts and both checkpoint chains. It detects altered/deleted/swapped cases, references, reservation/observation records, receipts and summaries. An interrupted run can be inspected, never restarted into more calls. Missing or uncertain evidence stays unresolved; it is not silently coerced into a successful grade. The final report is exclusive-created with read-only permissions.

Code and plan identities are rechecked at every execution boundary. Reservation counts and allowances come from the trusted shared ledger, with journal-confirmed reservation counts shown separately. A reservation consumed before its journal append still counts; a journal reservation with a missing or changed ledger receipt rejects replay. Unobserved started slots retain an unknown transport count.

## Reading a report

Reports retain the ten-slot denominator, five family pairs, exact request/input/reference hashes, full bound receipts, raw dispositions, per-axis matches, reference agreement, correct abstention, expected-good rejection, expected-bad raw approval, uncertain/invalid/unknown/unattempted outcomes, allowances, token usage and latency. They distinguish **accepted flawed / all five flawed** from **accepted flawed / all raw passes**, retaining both numerators and denominators. Partial results must be read alongside missing/uncertain counts. Paired/family descriptions are descriptive only: no general-population or independence-based confidence interval is calculated from five matched constructed families.

Transport counts reconstructed from observation checkpoints are labeled `observed_checkpoints_only`. A reservation without a durable observation leaves its transport count unknown and `exactTransportCount=null`; it never implies zero network calls. The shared reservation and its allowance remain recorded even when the response/checkpoint outcome is unknown.

Only a real Router run with at least one valid grade may label its report `measured_on_constructed_pilot`; a run with no valid grade says `not_measured_no_valid_grades`, and mocked transport reports say `not_measured_mocked_transport`. Even a complete live pilot does not qualify production calibration, a human benchmark, live learned-policy activation or answer-quality improvement.

The [version 1 frozen plan](evidence/grader-calibration-2026-10-14/frozen-plan-v1.json) is **unexecuted historical preparation**. Parent review changed the accounting and execution checks, so its earlier code binding intentionally fails current verification. Preserve it and prepare a new plan against the reviewed implementation before live execution. The [original offline qualification](evidence/grader-calibration-2026-10-14/offline-qualification-v1.json) records 417 server passes, one platform skip, build/CLI typecheck and offline plan verification at that earlier commit; it records no live grader result or calibration claim. All 111 protected files, including both initial preparation artifacts, remain unchanged. The shared ledger remains at 86 attempts, zero pending and $8.60 reserved before the live run.
