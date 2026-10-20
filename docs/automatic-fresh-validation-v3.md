# Automatic fresh-product validation v3

The user's direct instruction makes review automatic. This is a new decision amendment to the still-unread prospective experiment. The prior v1/v2 code, freezes, completed calls and human-review queues remain unchanged. No one is asked to manufacture a human review or clear those queues.

Two independent source-aware AI reviewers assess the complete sources and a third source-aware AI reviewer adjudicates their findings. Each retains the original assessments, literal evidence, conditions, unknowns and irreducible disagreements. These are provisional automated judgments: every new artifact records `humanSourceCheckedAnswers: 0`, `qualityClaimEligible: false`, and `activationAuthorized: false`. The new path permits bounded exploratory source preparation. It does not promote the policy, activate defaults, merge, deploy or approve provider spending.

The completed exposed development experiment supplies 24 actual answers on two exposed products, with two instruction sets, two repeats and three contexts. Its old qualification remains unchanged. The new automatic outcome verifier checks all 24 canonical receipt occurrences, exact source-aware review imports, third-reviewer adjudication and the separately frozen decision amendment. The amendment targets v6 versus v5 under the same `workspace-answer-uncertainty-v2` policy and retains flat-policy negative interactions as diagnostics. It does not reinterpret the 24 answers or eight repeated case instances as independent fresh products or use the old three answers as evidence of v6 gains.

## Automatic development review

`scripts/automatic-source-review-v1.ts` is an offline orchestrator. `--request --input PRIVATE --out NEW_PRIVATE` reconstructs the actual approved 24-answer journal, canonical receipt rows, anonymous output mapping and exact candidate/policy/design pins before issuing the source-only adjudication packet. `--complete --input PRIVATE --adjudication PRIVATE --out NEW_PRIVATE` validates the third review and saves its result. `--verify-outcome PRIVATE` repeats those checks. These modes contain no dispatch, credential or financial-approval path.

The primary exploratory decision compares four matched v5/v6 pairs under the same uncertainty policy. It requires a source-supported missing-report gain and rejects confirmed material regressions or unresolved material concerns. All 36 pair judgments, 48 designated fact judgments per reviewer, original negative findings and flat-policy/reference diagnostics remain saved. Missing unknown caveats are reported separately; they do not themselves assert an unsupported average or physical measurement. Source distortion, contradictory unknowns, material unsupported claims, applicability failures and lost designated qualifications still stop progression. The source-aware adjudicator assesses whether uncertainty is appropriate; the rule does not declare every omission harmless.

An uncertain result is retained rather than converted into agreement. A blocked outcome is also a valid saved outcome, but cannot qualify fresh-source access. Original historical outcomes and their manual gates are never rewritten by the new decision.

## Unchanged finite experiment

V3 retains the exact v2 seed, fixed 256-question source-only prefix, 24-packet pool and eight-case selection. There is no reseed, replacement, candidate-success filtering or source-gap quota added after outcomes. Minima remain one supported gap, two complete controls, one conflicting-report case and one insufficient-evidence case; tags may overlap. Every screened row, rejection and uncertain assessment remains in the saved denominator.

The custodian reads only the previously pinned local ePQA train CSV, after source-access qualification. It uses the existing source-only loader and CQA parser. It does not download a dataset, read answer/relevance columns, dispatch a provider or inspect candidate context. Complete literal parents and separate original CQA questions retain their conditions; overflow rejects the packet. It computes true body-only hashes in addition to the historical hashes that also include the original question. All viewed rejected parents, product families and model aliases remain protected, including oversized packets and raw candidates whose CQA scope could not be parsed. Those exposure hashes are saved in each inspected decision. Historical public/embedded source bodies and the new source-free old-live projection receive the same body-only protection.

Uncertain source eligibility cannot fill a stratum or enter the selected eight. Other independently qualified rows may fill the fixed quotas. If the fixed 24 cannot satisfy them, preparation records the shortfall and stops without replacing the pool. The exact v5 control is computed on every accepted packet before source eligibility review; v6 selections are computed only after the eight IDs are fixed. Only cached local models and exact saved query/document-bound logits are used.

## Frozen inputs and commands

Use the isolated report/uncertainty checkout. Every output is a new canonical file under private `.data`; do not publish actual answers, mappings or reviewer prose implicitly.

`metadata` returns prior path/hash metadata without opening the dataset or ledger:

```sh
python3 scripts/prepare-fresh-validation-v3.py metadata
```

Before fresh input, save a new private amendment with these fields:

```json
{
  "format": "ablatrix-automatic-fresh-decision-amendment-v1",
  "authorizedBy": "direct_user_instruction",
  "createdAt": "2026-10-19T00:00:00+00:00",
  "developmentOutcomePath": ".data/ACTUAL-AUTOMATIC-OUTCOME.json",
  "developmentOutcomeFileSha256": "EXACT_RAW_SHA256",
  "comparison": {
    "control": "v5",
    "candidate": "v6",
    "sharedGenerationContract": "workspace-answer-uncertainty-v2"
  },
  "diagnosticInstructionContracts": [
    "workspace-answer-flat-sources-v1",
    "workspace-answer-uncertainty-v2"
  ],
  "automaticReviewPolicy": {
    "independentSourceAwareReviewers": 2,
    "sourceAwareAdjudicators": 1,
    "irreducibleUncertainty": "retain_and_report"
  },
  "humanSourceCheckedAnswers": 0,
  "qualityClaimEligible": false,
  "activationAuthorized": false,
  "freshInputsInspectedBeforeAmendment": false,
  "paidPlan": null
}
```

The example timestamp and SHA are placeholders; the record uses the actual date and exact existing outcome bytes. The optional `authorizationText` belongs only in the private amendment. The new source-free old3 projection retains the old format and scoped hash fields, adds `sourceBodyFingerprints` computed as SHA256 of compact JSON `[NFKC-casefold-whitespace-normalized body]`, records `additionalFingerprintForms: ["literal_body_nfkc_casefold_v1"]`, and receives a new projection seal. Preserve its predecessors.

The automatic outcome has format `ablatrix-automatic-development-outcome-v1`, status `eligible_for_automated_exploratory_fresh_preparation`, exact candidate/policy/development-protocol raw hashes, `verifiedActualCompletedAttempts: 24`, `automaticReviewComplete: true`, `humanSourceCheckedAnswers: 0`, `qualityClaimEligible: false` and `newProviderCalls: 0`. It is not accepted on those assertions alone. The frozen command `scripts/automatic-source-review-v1.ts --verify-outcome FILE` must replay actual receipts and review/adjudication artifacts, return `ablatrix-automatic-development-outcome-proof-v1`, the same candidate/policy/outcome bindings and a real `canonicalActualReceiptsSha256`.

Create a new freeze, preserving all old directories:

```sh
python3 scripts/prepare-fresh-validation-v3.py freeze --candidate docs/evidence/report-uncertainty-v6-2026-10-19/candidate-freeze-v1.json --policy docs/evidence/report-uncertainty-v6-2026-10-19/uncertainty-policy-freeze-v1.json --exposure-projection .data/NEW-OLD3-EXPOSURE.json --development-protocol docs/evidence/report-uncertainty-v6-2026-10-19/development-protocol-v1.json --decision-amendment .data/AUTOMATIC-AMENDMENT.json --out-dir "$PWD/.data/fresh-automatic-freeze-v1"
python3 scripts/prepare-fresh-validation-v3.py verify --freeze-dir .data/fresh-automatic-freeze-v1
```

The freeze binds the whole new implementation/import closure, candidate, policy, source-free exposure, complete history, old development design, automatic outcome and decision amendment. Any changed binding requires a new versioned freeze before access; do not edit a frozen record.

## Independent automatic review records

Source-access and pool qualifications use formats `ablatrix-fresh-source-access-qualification-v3` and `ablatrix-fresh-pool-qualification-v3`. Their respective statuses are `reviewed_for_custodian_only` and `reviewed_for_source_only_screening`. Both require:

- `protocolFileSha256`, `candidatePolicyFreezeFileSha256`, `historyInventoryFileSha256`, exact `reviewedImplementationSha256`, and timezone-aware `reviewedAt` after the freeze.
- `provenance: "automated_independent_source_review"`, `freshInputsInspectedBeforeFreeze: false`, `automaticReviewComplete: true`, `humanSourceCheckedAnswers: 0`, `qualityClaimEligible: false`, `activationAuthorized: false`, `paidPlan: null`.
- Exact `developmentOutcomePath` and `developmentOutcomeFileSha256`; the verifier replays them before any dataset or pool path access.
- The exact `automaticReviewPolicy` above, two `independentReviewArtifacts` and one `adjudicationArtifact`, each a `{ "path": "canonical/repository/relative.json", "fileSha256": "..." }` descriptor.

Each of the three actual records has format `ablatrix-automatic-fresh-review-record-v1`, a distinct named `reviewer`, `sourceAware: true`, substantive `reviewEvidence`, `retainedUncertainty` array, `humanSourceCheckedAnswers: 0`, `qualityClaimEligible: false`, `activationAuthorized: false`, `providerCalls: 0`, and `paidPlan: null`. The first two use provenance `independent_source_aware_ai`; the third uses `independent_source_aware_ai_adjudication` and binds the two independent bytes in order with `independentReviewFileSha256`. All three bind `reviewStage`, exact `artifactSha256` map, and the applicable qualification status in `outcome`. No Boolean-only fallback exists. These named AI records provide inspectable provenance, not cryptographic attestation of reviewer identity or human calibration.

For `source-access`, the map contains the raw protocol, candidate-policy freeze, history inventory and automatic outcome paths/hashes. For `pool`, it additionally contains the separately verified source-access qualification, exact custodian record and committed pool path/hash. The pool qualification carries `sourceAccessQualificationPath/FileSha256`, `custodianRecordPath/FileSha256`, `poolPath` and `poolFileSha256`. It must bind the actual fixed 256-decision/24-packet custodian output, with no outcome fields or candidate selection used. A failed gate precedes any pool read.

After independent agents actually author and adjudicate those records, run:

```sh
python3 scripts/prepare-fresh-validation-v3.py custodian --freeze-dir .data/fresh-automatic-freeze-v1 --source-access .data/AUTOMATIC-SOURCE-ACCESS.json --train /Users/jayeshsuyal/Documents/ChatGPT/Ablatrix/repo/work/epqa/train.csv --out-dir "$PWD/.data/fresh-automatic-custodian-v1"
python3 scripts/prepare-fresh-validation-v3.py screen --freeze-dir .data/fresh-automatic-freeze-v1 --qualification .data/AUTOMATIC-POOL-QUALIFICATION.json --pool .data/fresh-automatic-custodian-v1/pool-v3.json --out "$PWD/.data/fresh-automatic-screening-v1.json"
```

## Full source review and selection

The new context CLI uses the same v5/v6 code through explicit format-only adapters; original v3 raw-byte hashes remain the bindings:

```sh
node --import tsx scripts/fresh-validation-contexts-v3.ts --baseline --freeze-dir .data/fresh-automatic-freeze-v1 --qualification .data/AUTOMATIC-POOL-QUALIFICATION.json --pool .data/fresh-automatic-custodian-v1/pool-v3.json --screening .data/fresh-automatic-screening-v1.json --out "$PWD/.data/fresh-automatic-baseline-v1.json"
```

The full source review has format `ablatrix-fresh-validation-source-review-v3` and provenance `independent_source_review_ai`. It binds the exact screening seal and raw baseline SHA, is candidate/answer blind, names the adjudicator and retains all 24 ordered cases. It carries the same automatic policy/evidence descriptors and honest zero-human/false-quality fields. Each case contains the existing full literal-source assessment: exact pool/context hashes, original-question/scope/family/title/reference review flags, designated literal quotes and source IDs, qualifications, applicability notes, references, tags, and unknowns. Accepted rows additionally declare `eligibility: "certain"` or `"uncertain"`; uncertain rows have substantive `uncertaintyNotes` and complete source/scope review, and cannot be selected.

All three separate review records use stage `source-eligibility`, bind the exact screening and baseline raw paths/hashes, and contain their own full 24 ordered `cases`. They record `candidateContextInspected: false` and `answerOutputsInspected: false`. The semantic validator checks all three complete assessments, including literal source containment and control/gap logic; a reviewer name plus Boolean is insufficient. The adjudicator's `cases` must exactly equal the aggregate review. It also retains all 24 `caseAdjudications`, each with `caseId`, the two `independentCaseSha256` values (canonical sorted-key JSON seal), `adjudicatedCaseSha256`, and a source-based rationale. Changed eligibility/tags/facts must be justified with those retained source assessments; unresolved applicability remains uncertain.

```sh
python3 scripts/prepare-fresh-validation-v3.py select --freeze-dir .data/fresh-automatic-freeze-v1 --qualification .data/AUTOMATIC-POOL-QUALIFICATION.json --pool .data/fresh-automatic-custodian-v1/pool-v3.json --screening .data/fresh-automatic-screening-v1.json --baseline .data/fresh-automatic-baseline-v1.json --review .data/AUTOMATIC-FULL-SOURCE-REVIEW.json --out "$PWD/.data/fresh-automatic-selection-v1.json"
node --import tsx scripts/fresh-validation-contexts-v3.ts --contexts --freeze-dir .data/fresh-automatic-freeze-v1 --qualification .data/AUTOMATIC-POOL-QUALIFICATION.json --pool .data/fresh-automatic-custodian-v1/pool-v3.json --screening .data/fresh-automatic-screening-v1.json --baseline .data/fresh-automatic-baseline-v1.json --review .data/AUTOMATIC-FULL-SOURCE-REVIEW.json --selection .data/fresh-automatic-selection-v1.json --out "$PWD/.data/fresh-automatic-contexts-v1.json"
```

The fixed eight retain candidate misses. Any designated v5 fact lost, no designated recovery, unsatisfied source-only strata, failed replay or pending exact context qualification stops the paid path. A successful source preparation still needs a fresh bounded financial scope and explicit approval: the prior 24-call approval is consumed. Local planning allowances are not settled provider charges or provider-enforced caps. Production `agents.run` stays closed.

## Verification

```sh
python3 -m unittest discover -s scripts -p 'test_prepare_fresh_validation_v3.py'
python3 -m py_compile scripts/prepare-fresh-validation-v3.py scripts/test_prepare_fresh_validation_v3.py
```

All fixtures are synthetic. They exercise gates before fresh path access, exact outcome/code/candidate/policy pins, three independent inspectable records, full semantic source assessments, retained uncertainty, fixed prefix/denominator, body-only and CQA-scope protection, and rejected-packet exposure. The checks read no fresh CSV and dispatch no provider call.
