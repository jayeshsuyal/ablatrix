# Sealed grader qualification benchmark

PR 1 builds a reviewable **offline qualification contract** for the frozen v3 grader. The [six-case live smoke](evidence/grader-coverage-confidence-2026-10-15/live-results.md) remains development evidence. This benchmark has made **zero live calls**; its qualification record is **pending**.

## What is sealed

- **80 unique fictional product/source packets:** 60 flawed answers, 12 correct factual answers, four honest qualified answers and four justified refusals. Two refusal controls have absent facts; two have unresolved source conflicts.
- **12 fixed repeat checks:** eight flawed anchors from conditional, temporal, comparative, embedded-instruction, wrong-model, citation, partial-coverage and unnecessary-refusal categories; two factual, one qualified and one refusal control. Repeats use distinct run IDs but exactly the same wire request as their primary case. They never increase the primary 60/20 denominators.
- The exact v3 prompt hash, requested model/accepted response aliases, tool schemas, requests, source/answer hashes, code and dependency manifests, category inventory, repeat schedule and engineering thresholds.
- Separate `requests.json` and `references.json` files. Only ordinary question/product/source/answer fields enter grader requests. Labels, rationales, categories and review provenance stay outside them.

The 60 flawed answers cover 12 categories, five packets each: conditional exceptions, temporal updates, comparisons, source-embedded instructions, wrong-model Q&A context, citation semantics, explicit contradictions, partial coverage, unnecessary refusal, mixed unsupported assertions, units/relationships and quantifiers/attribution. The author used the frozen rubric and taxonomy. New source relationships exercise transfer; some categories deliberately preserve known failure patterns. New product names alone do not establish transfer or statistical independence.

V3 is frozen at system hash `ffae52c2c183f909047f1867a73a505440b1ee22fe8b5db2d9e4a591a86e0067`. A changed prompt fails sealing under this contract. A future prompt change consumes this cohort as development material and requires fresh qualification cases. Binding `gpt-luna` and permitted response aliases does not pin the upstream model weights.

### Reference ambiguity resolved before execution

Five citation-semantics packets state a fact established elsewhere in the source body but cite an irrelevant actual span. The current validator can represent this as unsupported cited support or supported uncited proof; both require `repair`. Their support/confidence alternatives are declared in the references before any live outcome. Their coverage, answerability, source correctness and mandatory repair remain fixed. The other critical reference axes remain narrowly specified.

An independent AI reviewer source-checked all 80 packets. The detached review record binds the exact dataset and fixture hashes. Construction-time pending labels remain immutable. AI review and author attestations about freshness are not authenticated human gold, external truth verification, proof of never-live history or production calibration. The operating scope is explicitly limited to fictional frozen text packets and single-unit answers; it excludes long-answer behavior, production error rates, retrieval/generation quality and policy activation.

## Predeclared engineering gates

| Measure | Requirement |
| --- | ---: |
| Valid primary / repeat grades | 80/80 and 12/12 |
| Flawed primary answers receiving raw pass | **0/60** |
| Primary critical support, coverage and confidence axes | All 80 match their permitted frozen sets |
| Acceptable primary dispositions, including justified abstention | **20/20** |
| Primary full-axis and disposition agreement | At least **76/80** |
| Repeat axes and dispositions | **12/12 stable** |

These are predeclared engineering choices. Invalid or missing observations prevent a pass; uncertain outcomes remain visible and cannot substitute for matching expected labels. A blanket refusal/uncertain strategy fails the acceptable-answer and critical-axis gates. Reasons can vary between repeats; assessed axes and dispositions must remain stable. Repeats are consistency checks rather than additional independent cases. No production confidence bound is claimed from this constructed cohort.

## Offline reproduction

Requires the repository's Node.js runtime and dependencies. Commit the reviewed implementation before sealing; the CLI compares the current code/dependency bytes with that exact commit. Use new absolute output paths:

```sh
npm ci
npm run grader:qualification
npm run grader:qualification -- --prepare \
  --implementation-commit "$(git rev-parse HEAD)" \
  --out "$PWD/.data/grader-qualification/seal-v1"
npm run grader:qualification -- --verify \
  --dir "$PWD/.data/grader-qualification/seal-v1"
npm run grader:qualification -- --rehearse \
  --dir "$PWD/.data/grader-qualification/seal-v1" \
  --out "$PWD/.data/grader-qualification/rehearsal-v1.json"
```

Preparation creates four exclusive, read-only JSON files in a new directory: `plan.json`, `requests.json`, `references.json` and `record.json`. Existing or partial seals cannot be overwritten or resumed. Verification reconstructs them against current committed fixtures/code; edited self hashes cannot waive those bindings. Keep the recorded code checkout for historical verification after implementation changes.

The rehearsal scripts expected outputs from references to exercise evaluator mechanics. It does **not** query a judge or measure accuracy. Its provenance is always `offline_reference_scripted_mechanics_only`, its provider-call count is zero, and `qualified`, `productionActivationQualified` and `qualityClaimEligible` remain false. Even supplied real-looking output JSON cannot change those fields. All 92 slots, invalid/missing outcomes, primary category metrics and repeat consistency remain inspectable.

```sh
node --import tsx --test server/grader-qualification*.test.ts
npm test
npm run build
```

## Qualification record and live boundary

`record.json` binds the exact plan, dataset, references, reviewed implementation and grader configuration. Its status is `pending_live_evidence`, scope is `none`, and live evidence is null. The current CLI supports **prepare, verify and rehearse only**. It does not import a provider, open credentials or a ledger, load `.env`, accept a transport hook, or provide `--execute`. Ambient live flags grant it no capability.

The proposed live benchmark would use **92 grading calls / at most $9.20 added local planning allowance**. That is unapproved preparation, not a settled charge or provider-enforced cap. The previous 102-attempt scope is consumed; this PR does not extend it.

Before live execution, a separately reviewed execution/verifier adapter must bind the approved shared-ledger starting state and finite budget, merged code, exact seal and review evidence, canonical intent/claim, append-only checkpoints and one receipt/reservation per slot. It must enforce stopped competing workers, exact request/model/schema hashes, bounded transport and no retries, then reconstruct observations from trusted ledger rows. It must track consumption by dataset hash: creating a new seal or new run IDs cannot authorize a second qualification attempt on an exposed cohort. Caller-supplied mode flags or uploaded JSON cannot issue live qualification. Any future qualified-record schema needs that trusted verifier; this pending record cannot be upgraded by editing JSON.

A successful benchmark would support a scoped grader decision under its declared reference provenance. Candidate answer-policy improvement still needs a separate fresh product-disjoint evaluation; activation requires its own reviewed gate, authorization and rollback. Existing automatic workers retain v1, historical experiments remain unchanged, and live policy activation stays closed.
