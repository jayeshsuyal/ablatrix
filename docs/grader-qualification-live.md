# Bounded v3 qualification adapter

This adapter executes the already [sealed qualification benchmark](grader-qualification.md) without changing its v3 prompt, fictional packets, references, wire requests, schedule or pending PR 1 record. **Building, reviewing and preparing this adapter does not authorize paid calls.**

## One workflow

1. Merge reviewed adapter code. Prepare a separate execution plan against that exact implementation commit and the first 102 unchanged shared ledger rows.
2. Publish the plan and show its exact budget to the operator. Only after a direct approval of that plan, record that response in the separate authorization file. A plan acknowledgement or source review is not financial approval.
3. Stop and drain all app/worker processes sharing these stores. Start `sh scripts/grader-qualification-native.sh --execute ...` from the trusted operator terminal with the independently opted-in process-scoped limits; leave app settings unchanged. The reviewed shell launcher removes Node preload/lookup hooks before creating a fresh native Node process. The production entry point opens a native macOS confirmation showing the full plan hash, exact budget and prefilled plan challenge. The operator reviews it and clicks **Approve $9.20**; no typing is required. Cancel remains the default. Cancel, timeout or an altered challenge make no calls. Other/headless hosts fail closed. Approval JSON is audit metadata and cannot replace this interactive channel.
4. Execute the 80 primary grading requests and 12 fixed repeats in their original order, stopping as soon as a frozen failure rule fires. Preserve every unattempted slot. There are no retries or resumes.
5. Independently replay the canonical private checkpoint, dataset claim and actual shared ledger. Publish a new live report and qualification record; retain every historical artifact unchanged.

A confirmation-UI repair changes the code and execution-plan hashes. Preserve the old plan and approval transcript. If the frozen requests and full financial scope remain unchanged, record the original scope approval, its timestamp/hashes, and the later continuation separately in a private provenance note. Do not represent an old-hash quote as approval of a new hash. Fresh native confirmation of the displayed new plan remains mandatory before dispatch; the saved transcript is audit metadata only.

Preparation is read-only except for exclusive publication of the new plan. It reads no credential and constructs no provider:

```sh
node --import tsx scripts/grader-qualification-live.ts --prepare \
  --implementation-commit <reviewed-merged-40-character-commit> \
  --out "$PWD/docs/evidence/grader-qualification-live-2026-10-15/execution-plan-v1.json"

node --import tsx scripts/grader-qualification-live.ts --verify \
  --plan "$PWD/docs/evidence/grader-qualification-live-2026-10-15/execution-plan-v1.json"
```

After a run, `sh scripts/grader-qualification-native.sh --replay --plan <same-absolute-path>` reconstructs the result without credentials, network calls, new files or dispatch. No command loads `.env`. Full Git history is required to verify both recorded implementations.

## Exact proposed financial scope

| Item | Bound |
| --- | ---: |
| Existing attempts / reserved allowance | 102 / $10.20 |
| Primary cases / repeat checks | 80 / 12 |
| Maximum new calls | 92 grading calls |
| Allowance per call | $0.10 |
| Maximum added planning allowance | $9.20 |
| Absolute cumulative attempt ceiling | 194 |
| Maximum cumulative reserved allowance | $19.40 |
| Existing prior-spend adjustment | $0.200281 |
| Maximum combined planning usage | $19.600281 |
| Proposed cumulative local cap | $20.00 |

These are local planning allowances, **not settled charges or a provider-enforced spending cap**. Early stopping can use fewer calls. Existing 102-call / $11 authorization is exhausted. The new 194-call / $20 scope requires explicit approval after the reviewed plan is published. No generation, repair, search, training, proposal or policy activation is included.

## Guardrails and evidence

- The production entry point accepts only the frozen plan path and its exact acknowledgement. It owns the actual ledger reader, canonical caller scope and Router transport. No injected provider, transport, receipt JSON or caller-selected `live` flag can certify a result.
  Paid execution and certifying replay require the CLI's module-local native-main capability. Importing callers are rejected before any private file, credential, provider or network access, even if they patch built-ins or spoof argv. The standalone main locks the implicated built-ins before executing. Offline preparation, static plan verification and mechanics remain non-certifying.
  Production uses a captured Node HTTPS request function with a fixed TLS host/path, certificate validation and no shared global agent. It never reads the caller's mutable global `fetch`; low-level wire mocks are separate mechanics tests.
- Dispatch obtains approval directly from the system-owned native dialog interpreter, with no stdin, environment, file or caller hook supplying the confirmation result. Saved approval/confirmation fields are audit bindings, not cryptographic authentication of a human identity or standalone dispatch authority. Scope and worker checks repeat after confirmation and before cohort consumption/provider construction.
  The operator must complete the native confirmation; agents must not automate its text entry or approval button.
- Private exclusive claims use the dataset hash. A new output path, rehashed plan or different run IDs cannot reopen this cohort. An interrupted append fails closed; replay never repairs or resumes it.
- Before provider construction and at every reservation/transport/operation/publication boundary, checks bind current code, original source artifacts, approval, all 102 historical rows, sole new reservations, pending identity and stopped workers. Transport permits one exact POST per reservation, redirects disabled, a 45-second signal and a 128 KiB response-body limit.
  The manifest covers every runtime-loaded project module, including the provider's policy and review dependencies. CI derives the import graph and fails on any omission; package versions remain bound by the original package/lock files within the stated trusted-host model.
- Reports separate the 80-case primary denominators from the 12 repeat checks. Invalid/unknown outcomes retain their consumed allowances. Unknown transports remain unknown; a passing prefix cannot qualify.
- Frozen failure rules stop on an invalid/unknown result, a critical-axis miss, a flawed raw pass, an acceptable-answer misroute, an unstable repeat or more than four full-axis primary misses.
- Qualification requires all 92 valid outcomes, zero flawed primary passes, 80/80 critical-axis matches, 20/20 acceptable dispositions, at least 76/80 full-axis matches and 12/12 stable repeats. The non-injectable verifier issues a separate record only for the complete live execution.

## What a pass means

A passing record qualifies v3 for **constructed single-unit source-support shadow evaluation**. References have an independent AI source-consistency review; they are not human gold or externally verified truth. The record binds locally observed Router transport and ledger receipts, not provider-signed billing or pinned upstream weights.

Execution trusts the operator to start the reviewed shell launcher on an uncompromised host. Direct Node invocation, arbitrary preloads/loaders and embedding execution inside another JavaScript program are unsupported. Checking current env/argv cannot prove that an already compromised process never ran a preload; this adapter is not a sandbox or cryptographic host attestation.

Citation matching, grader/reference agreement, answer correctness and human-reviewed quality remain different claims. This benchmark does not establish real-user answer improvement. Production activation and policy promotion remain closed; the existing workers retain their current grader. A future integration must explicitly consume this scoped record and separately satisfy the activation gates.

## Offline verification

```sh
node --import tsx --test server/grader-qualification-live*.test.ts scripts/grader-qualification-live.test.ts
npm test
npm run build
```

Tests use isolated temporary ledgers and explicitly mocked transport. Even 92 perfect fabricated outcomes cannot produce a production qualification record. CI also reproduces the original PR 1 seal in its historical implementation checkout; package files and historical artifacts remain unchanged.
