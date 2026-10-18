# Proof and qualification protocol

The product export compares a saved original answer with its one bounded repair. Future-policy trials are a separate experiment. The export does not establish a quality gain: current judgments are unqualified AI estimates or scripted synthetic labels.

## Inspect and verify

`GET /api/workspace/proof` provides the paired view; `/api/workspace/proof/export` downloads the exact bundle. It contains all generated workspace requests, including failed and unresolved requests, with a separate repair-triggered denominator. Preview-only requests are counted as excluded. Legacy generation records retain their unknown replay contract.

Each case retains its full original run, source snapshot, generation contract, policy binding, original and repair assessments, exact request identities, receipts, versions, statuses, and unknown measurements. Completed new generation and check records must replay against their receipts before export. The standalone verifier performs no dispatch or reservation:

```sh
npm run proof:verify -- --verify /path/to/ablatrix-paired-proof.json
```

A bundle checksum detects accidental changes; exact receipt replay detects inconsistent requests, sources and saved outputs. These local records do not independently attest a provider's authenticity or settled charges. A locally observed workspace history is not a prospectively frozen independent cohort. Rehashing or selecting a smaller export cannot establish freshness or quality.

Reported time is the sum of each case's elapsed time from request creation through its final check, including retrieval, queues, failed and unresolved attempts when measured. Missing durations and usage stay unknown. Synthetic operations have zero provider calls; their logical operation count is separate. Live receipt counts represent recorded provider attempts/reservations; actual transport can remain unknown. Planning allowances include recorded reservations and are not provider charges. Wins and ties reflect the recorded automated rubric, not source-checked human improvement.

## Matched development control

```sh
npm run proof:development -- --out work/new-development-proof.json
npm run proof:verify -- --verify work/new-development-proof.json
```

This command blocks network access and uses two exposed fictional source packets. One follows the scripted repair path and one stops unresolved. For the repaired case, it runs an additional rewrite using the same revision prompt, model, rejected answer, source packet and clarifications, with only `reviewerCritique` emptied. Both rewrites receive an independent check under the same frozen grader. The original remains the control. Scripted templates do not react semantically to the critique; their tie proves the matched protocol and does not demonstrate feedback benefit. The output cannot qualify a live grader or policy.

## Prepare fresh experiments

Data roles remain distinct: exposed development, deliberately acceptable/defective judge-qualification cases, natural-baseline workflow holdout, and later future-policy holdout. Holdout documents are available in the frozen retrieval index; hidden queries and source-checked references remain outside tuning. Repeated observations do not become independent products.

`grader-v4-qualification.ts` prepares a pending plan from a separately curated packet. It freezes exact inputs, references, code manifest, prompt/schema/model/scope, stopping rules, repetitions and budget. Exposure fingerprints cover case content, source packets and canonical related-family aliases across cohorts; renaming IDs cannot make an old packet fresh. The plan requires one, two and three answer units, the 1500-character maximum, and an assertion spanning a unit boundary. Independent source and family-alias review remains pending. A prepared, failed or incomplete plan grants no live qualification. Existing consumed v3 qualification packets must never be resumed or relabeled after tuning.

`workflow-proof-plan.ts` prepares metadata-only plans from independently reviewed qualification, workflow and future-policy manifests. It rejects reused canonical families and requires source-index, query, reference and review hashes. It does not open hidden queries or labels or provide a paid executor.

```sh
npm run proof:verify -- --proposal
```

The provisional sample-size illustration targets a 10 percentage point useful-answer gain, assumes 30% discordant pairs, and tolerates at most 2% regressions, with a separate stop for any severe regression. A paired normal approximation at two-sided alpha .05 and 80% target power yields 234 independent families per fresh comparison. With an illustrative 80-primary/three-repeat qualification and at most four calls per family in each comparison, the upper proposal is 1955 calls and $195.50 additional planning allowance. These are planning assumptions, not observed variability, an approved budget or guaranteed power. Development pilot variability, exact paired analysis, fresh independent packets, source-checked human review and explicit approval of the concrete plan are required before execution. A smaller demonstration must keep that label.

Stop on unknown provider outcome, invalid result, severe regression or qualification failure. Preserve the baseline if a comparison is incomplete, shows no useful gain, or fails the independent review gate. Judge qualification alone never releases an answer policy. Final answer-quality claims and promotion retain the repository requirement for source-checked human review plus fresh product-disjoint gain.
