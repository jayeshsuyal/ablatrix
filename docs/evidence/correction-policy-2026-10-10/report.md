# Correction-policy round: development passed; fresh run stopped

October 10, 2026 (Pacific). **No fresh quality gain is established and no policy was promoted.** The revision-only candidate and blind comparison workflow are implemented. The approved experiment stopped on an invalid citation during shared original-answer generation.

| Stage | Recorded result | Interpretation |
| --- | --- | --- |
| Development | 6/6 candidate calls completed; 18/18 exact citation spans; all six frozen AI criteria passed | Nonblind AI qualification on previously exposed cases, not human-reviewed improvement |
| Fresh execution | 4/24 planned calls attempted; three accepted outputs and one rejected output; 20 not attempted | One complete revision pair out of eight planned; the comparison is incomplete |
| Fresh citations | 6/7 returned quotes matched, counting the rejected response | Mechanical provenance only; the seventh quote triggered the stop |
| Human quality | Zero fresh judgments | No correctness, adequacy, preference or quality-gain result |

This round used **10 new attempts** across both stages and **$1 in local planning allowances**, below the approved 30-attempt/$3 maximum. The shared ledger moved from 63 to 73 attempts. Actual provider charges are unavailable; allowances are not settled bills or a provider-enforced cap. There were no web calls, automatic retries or replacement products. Existing receipts and review state were unchanged.

## What was frozen

The [development plan](development-plan.json) was committed at `54e1982` before its six calls. Its [saved outputs](development-results.json) and [AI assessment](development-ai-review.md) preserve both the passed criteria and remaining verbosity.

The fresh [execution manifest](validation-plan.json) was published in commit [`f6ce5ee`](https://github.com/jayeshsuyal/ablatrix/commit/f6ce5ee40b9a54ed521c72bd08af5b485b6ea22a) before fresh generation. Its canonical SHA-256 is `44ec8d2a8ee3c2bfe9905d9842dc91166445e715ff03e9d946daebd38fd1d190`. It binds implementation `c3da055`, eight distinct products, all 174 review sources, five hybrid-retrieved chunks per question, a shared prewritten critique, exact instructions/settings and the 24-step execution order. Each pair revises the same original answer using the same context; only the revision instructions and version label differ.

The [passed family audit](manual-family-audit-v3.json) covers full source pools, question/title identifiers and near model families. Two earlier preparation versions failed eligibility before any fresh calls; their records and prospective amendments remain saved. The [replay note](preparation-replay-note.md) distinguishes exact reproduction of model inputs from two diagnostic title-tie differences.

## Why the run stopped

The first product produced its original answer and both revisions. The second product's original response returned HTTP 200 and a provider receipt, but failed local output validation: it cited a supplied `item_dimensions` passage while rewriting its text. The 225-character quote omitted three outer `value` fields from a 259-character source and changed whitespace. Normalizing whitespace would not repair the omissions.

The receipt remains `completed` with `error_code: output_validation`: provider completion and accepted application output are different facts. The strict citation validator rejected the response, and the runner stopped as specified. It did not retry, continue spending, replace the case, or convert the one completed pair into an eight-product result.

The [execution summary](validation-execution-summary.json) retains all 24 planned steps, hashes, receipt IDs, statuses and mechanical checks. Raw fresh responses remain private to avoid revealing the completed pair's arm identities before human review. This limits independent public verification of those outputs; their hashes do not authenticate the provider. The partial cohort was not imported because the comparison contract requires completed shared originals for every imported case. There is no new 16-answer review queue from this stopped run.

## Reproduction and next step

For a no-call workflow check, run:

```sh
node --import tsx --test server/context-comparison.test.ts server/context-comparison-api.test.ts
npm run test:e2e -- e2e/context-comparison.spec.ts
```

The [cohort preparation instructions](cohort-preparation.md) reconstruct the public inputs. The saved manifest contains the exact retrieved context. The live runner intentionally refuses replay or overwrite: its ledger count, code hashes, prompt identities and new output path must match the approved round. Do not rerun it to erase the stopped result.

The next technical target is **server-resolved citation IDs or literal source spans**, tested offline against structured attribute text. Freeze any changed citation interface consistently in a separate experiment; retain strict quotation checks. The candidate remains available for evaluation, while ordinary product revisions keep their baseline policy.

Verification: **243 server tests passed**, one Linux-only skip; production build and **31 Chromium checks passed**. The fresh runner passed a separate strict TypeScript check, and a no-call synthetic import accepted all eight actual source pools. Localhost was restored with live generation, external discovery and telemetry disabled.
