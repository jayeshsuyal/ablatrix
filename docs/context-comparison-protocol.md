# Original-question context comparison

Status: protocol for the next evaluation workbench, October 9, 2026. No fresh live comparison or human-reviewed quality result is recorded by this document. This document distinguishes the workbench's import/review contract from the additional requirements for a future prospective experiment.

## Question and scope

Does retaining a customer answer's original question improve supported, adequate answers to a new product question?

The workbench imports a completed paired-answer packet containing 1–20 distinct products, freezes it for blinded review, records source-checked judgments, and produces a locked report. A synthetic packet exercises the same workflow. This release does not add a paid runner. Existing provider dispatch and its separate live authorization, planning allowances, and receipt checks remain in place.

Building and testing the workbench can finish while real review and live execution are pending. Importing a packet makes no provider call and does not accept an answer or promote an answer policy.

## One intervention

| Arm | Model-visible product evidence |
| --- | --- |
| Control | Answer bodies, source identities, and references; original customer questions omitted |
| Candidate | The identical bodies, identities, and references, with original customer questions attached as context |

Normalize legacy CQA passages once, before constructing either arm: separate the inline ` Question: ` suffix from the answer body. The control omits both the explicit `originalQuestion` field and any remaining inline copy. The candidate receives the separated question. Source questions are context and cannot supply citation quotes.

Both arms use the same current source-context rules, answer policy, requested model route, returned model identity, generation settings, response schema, citation interface, output validation, and cleanup. In particular, the current rules in [the provider](../server/feedback-provider.ts) remain in both arms. This tests the availability of question metadata under fixed instructions.

These are requirements for the future experiment. The import contract reconstructs and hashes a declared input containing the model alias, policy, prompt-version label, source selection, question metadata, and quote menu. That check does not capture or authenticate the original transport request, full system instructions, decoding controls, or retrieval configuration. Preserve those additional artifacts when executing the prospective experiment; a version label alone cannot prove the complete generation configuration.

Retrieve once per product question, then freeze the selected passage IDs, bodies, order, retrieval configuration, and quote menu for both arms. Freeze the complete source pool separately for review. The candidate must not gain extra answer text, a different retrieval, a revised policy, a reviewer critique, or external search. Keep this control transformation inside the experiment; normal product answers continue to preserve context.

Historical paid answers cannot serve as the control for a fresh causal comparison: their generation protocol, timing, and available context differ. They remain useful development examples.

## Before a real comparison

For a future prospective experiment, freeze the hypothesis, cohort size, selection rule and seed, eligibility checks, both arm configurations, execution order, rubric, report definitions, attempt bound, and stopping rules before any generation. Preserve their hashes and a dated pre-generation record, such as a committed protocol and manifest. The later workbench import freeze protects review integrity; it cannot retrospectively establish preregistration. Submitted timestamps alone are insufficient proof of when an experiment was planned.

The current workbench labels imported live packets as retrospective, with pre-generation freeze and provider authenticity unverified. Import validation can establish internal consistency of submitted records; it cannot authenticate a claimed provider response, independently prove that a source pool was exhaustive, or certify freshness from a supplied declaration. The requirements below need a separate audit before any fresh-comparison claim.

For a fresh packet:

- Use a new product-disjoint cohort from the pinned ePQA train snapshot. Preserve the upstream checksum, license, row references, source identities, body hashes, and original-question context.
- Exclude all 56 ASINs already in the 16-product development/validation corpus, the separate 20-product final corpus, and the 20-product paid batch. Add any subsequent workspace or experiment exposures. Record the exclusion set and its provenance; a fresh workspace UUID does not make a previously used product fresh.
- Complete a product-family and near-duplicate audit before generation. Exact ASIN separation and first-title-token heuristics alone are insufficient. Preserve the audit outcome and exclusions.
- Select without consulting generated outcomes or filtering to original relevance-label `2` passages. Preserve the full eligible product source pool, including distractors. Keep dataset answers and relevance labels outside retrieval and generation inputs.
- Reserve the cohort before dispatch. Preserve failed and uncertain attempts. Alternate arm execution order and assign anonymous review labels independently of dispatch order.

The two remaining legacy validation products and the existing final corpus stay reserved for their original protocol. A metadata-only local audit found a substantial unused train pool, but no new cohort has been frozen or certified as fresh. The upstream test split is unnecessary for this release.

Stop execution on an uncertain provider outcome, model/configuration mismatch, or exhausted allowance. Do not silently retry, replace difficult cases, or omit failures to complete a favorable packet. An incomplete execution record remains inspectable; it cannot produce a complete paired quality result. New authorization and a separately recorded protocol are required for any later execution outside the original bounds.

## Import and review freeze

The completed packet must identify the experiment manifest, supplied source pool, retrieval snapshot, arm configurations, answer versions, declared live or synthetic provenance, and execution outcomes. Validate source ownership, pairing, and hashes, and display each answer's exact citation membership check. A completed answer with a failed mechanical citation check remains inspectable, but cannot receive a supported judgment. Duplicate unchanged imports are safe; conflicting content under an existing identity must fail. Preserve separate provider receipts when available; declaring a live mode does not verify those receipts.

Once imported, preserve the frozen answers and context. Review judgments bind to the exact answer version, source-context digest, and rubric version. An answer revision belongs to the product's development workflow; it cannot replace an answer inside a frozen comparison.

Review cards show anonymous A/B answers and the complete source context, including original customer questions, for both arms. Conceal arm association, model identity, timings, token usage, and arm-specific metadata until the review set is locked. Treat source text and any instructions inside it as untrusted material.

## Human rubric

Record an explicit judgment on each axis:

| Axis | Values | What the reviewer checks |
| --- | --- | --- |
| Correctness | Correct / incorrect / uncertain | The response accurately addresses the selected product and requested relationship. It does not transfer a claim from another model, part, variant, or customer question. |
| Support | Supported / unsupported / uncertain | Every material factual claim is supported at the strength stated. Citations apply to that claim in their original context; a literal quote alone is insufficient. |
| Adequacy | Adequate / inadequate / uncertain | The response answers supported parts, identifies genuinely unresolved parts, and gives a useful clarification where needed. It avoids both unsupported certainty and unnecessary abstention. |

Require reviewer attribution, explicit source-check confirmation, checked source identities bound to their context, and a note explaining failures or uncertainty. Local reviewer names are attribution fields, not authenticated identities.

Exact quote membership is a separate mechanical measure. Model-reported `answered` status, an AI opinion, a preferred writing style, and product-queue acceptance are separate observations; none substitutes for these judgments.

Keep AI review suggestions separate and hidden during independent blind review. AI-authored records and synthetic judgments cannot satisfy a human review gate. Human decisions must be made and submitted by a person. Live workbench judgments require an explicit affirmation that the reviewer personally checked the sources without AI review suggestions; a known AI-assisted judgment does not meet this gate. A local form cannot authenticate the reviewer or independently verify that affirmation. The workbench does not inherit AI drafts or approvals from the other review queues.

The historical paid batch has 20 pre-context human judgments and **0/20 source-context-valid judgments** as audited on October 9. Its current page provides disclosed AI suggestions. Those cases can calibrate the rubric and collect development feedback; they do not become fresh evaluation cases when reviewed again. Preserve the historical records and their exclusions.

## Report and stopping rules

Show execution progress, citation checks, and the number of pending human judgments while review is incomplete. Keep aggregate quality conclusions pending until all eligible pairs have explicit, locked human judgments. Count pairs over the complete frozen cohort and disclose every missing or ineligible pair; do not improve a denominator by dropping inconvenient outcomes.

An answer meets the primary criterion only when correctness, support, and adequacy all pass. Report each axis and uncertainty counts separately. For fully resolved pairs, report candidate wins, baseline wins/regressions, and ties on that composite criterion. Pairs containing an uncertain judgment remain explicitly unresolved; do not convert them to failures, ties, or quality gains. A complete gain conclusion remains unavailable while material uncertainty or incomplete pairs remain.

The report preserves the planned and eligible pair counts, review provenance, per-pair outcomes, citation membership, response-status coverage, model identities, timing definitions, and recorded per-attempt token usage where available. Imported retrospective records support descriptive, exploratory review outcomes only: their selection, execution, and pre-generation freeze remain unverified. The workbench reports `qualityClaimEligible: false` and no inferential interval. A numerical advantage or a degenerate small-sample bootstrap interval cannot establish improvement. Actual provider charges remain unavailable unless separately verified; planning allowances are never reported as billed savings.

Each judgment becomes immutable on its first save; replaying the same submission is safe, but even a mistaken judgment cannot currently be edited. Reporting requires a judgment on every completed answer. The report is derived from the frozen packet and saved judgments; this release has no amendment API. A future correction mechanism must preserve the original report and attach a versioned amendment with its reason and provenance. A tie, regression, inconclusive result, or no useful effect is a valid outcome. Do not keep modifying the intervention against the same exposed cohort until it wins. No report automatically changes the active policy or accepts a product answer.

## Release checks without paid calls

- A synthetic completed packet imports, survives restart, receives explicit synthetic review, and exports a clearly labeled report.
- Changed manifests, source context, arm bodies, retrieval, quote menus, model configuration, or duplicate answer identities fail validation.
- Legacy suffix normalization leaves identical quoteable answer bodies in both arms; equal bodies with different parent questions keep distinct source identities.
- Anonymous API responses and exports conceal arm association until review locking.
- Legacy judgments, AI drafts, synthetic records, and product-queue acceptance cannot satisfy live human quality gates.
- Missing judgments, uncertain judgments, invalid source checks, and incomplete pairs preserve honest pending or inconclusive states.
- Frozen answers and completed reports reject overwrites; existing experiment files, review counts, validation reservations, and active policies remain unchanged.

See the [next release plan](next-release-plan.md), [source-context implementation](source-context-recovery.md), and [existing policy-evaluation protocol](feedback-loop-v0.2-protocol.md).
