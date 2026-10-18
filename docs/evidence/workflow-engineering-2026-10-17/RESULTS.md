# October 17 product workflow engineering

All six engineering slices are implemented. Live v4 qualification, natural-product correction benefit and live policy release remain unestablished. This build made **zero paid calls**.

## Verification

Parent review added regressions and fixed incomplete repair histories, final-delivery metrics, frozen historical grader replay, terminal browser-intent recovery and unfinished workflow timing. The final server suite passes **536 tests with one platform skip (537 total)**; **46/46 normal** and **12/12 isolated-demo** browser checks pass, alongside production/demo builds. CI includes both browser suites. Historical evidence packets remain unchanged. See the dated entries in the [build ledger](../../build-plan.md).

The original build verification is retained below:

| Check | Result |
| --- | --- |
| Server suite | 532 passed; one platform-specific skip (533 total) |
| Full Chromium suite | 44/44 passed, including mobile, hosted roles, retry, recovery, sources and exports |
| Isolated demo browser suite | 10/10 passed |
| Production and isolated demo builds | Passed |
| Standalone CLI TypeScript / offline CLI guards | Passed / 3 tests passed |
| Existing Python cohort selector | 7/7 passed |
| Injected reliability contracts | 11 retrieval scenarios / 85 checkpoints; 4 harness / 64; 6 workspace / 54, all pass |
| Cached pinned-BGE reliability | 11 retrieval scenarios / 74 checkpoints; 4 harness / 64; 6 workspace / 54, all pass |
| Walkthrough | Actual 72.005-second browser recording; zero external requests; downloaded proof verified offline |

The full server pass includes the independent-review regressions for cross-binding a check to its original run, tampered generation identity without a check, missing receipt accounting, invalid completed-output diagnostics, persistent review-handoff failure during retry, and attribution/history checks. Historical v1–v3 replay remains intact. The consumed v3 execution source guard correctly rejects the changed current implementation; mechanics tests read a temporary source-only copy of the exact sealed public commit. No historical seal or execution artifact was rewritten.

## Exact offline evidence

- [Injected contracts](injected-v1.json) and [cached pinned BGE contracts](pinned-bge-v1.json) retain expected/observed checkpoints, exact source hashes, embedding identity and `semanticAssessment: not_run`.
- [Initial injected assertion failure](injected-initial-assertion-failure.json) is retained. A random source-ID tie could make the scripted answer cite the competing variant while the complete manual remained in generation context. The assertion was corrected to inspect the required complete generation bodies; independent flat-ID tests verify exact full-body citation resolution. No quality label was inferred from that template's citation choice.
- [Development retrieval replay](retrieval-development-v1.json) covers ten already exposed questions: BM25 and hybrid retrieve 33/34 annotated reference passages, dense 34/34; every question has at least one reference. [Diagnostic scope and code identities](retrieval-diagnostics-v1.json) separate reference omission, reproduced conditional-context loss/restoration, missing/conflicting information and unmeasured natural generation misuse. Upstream annotations are AI-assisted; this is not semantic sufficiency or answer correctness.
- [Paired development proof](development-proof-v1.json) retains two fictional workflow requests: one scripted repair win and one unresolved stop. The repair-triggered subset contains one case. A matched extra-call rewrite removes only the critique and receives the same scripted passing label as the guided repair. It does not establish feedback benefit. All eight logical operations across the workflow and extra control are synthetic; provider calls and planning reservations are zero.
- [Prospective budget illustration](prospective-budget-v1.json) remains unapproved and lacks independent packets and observed pilot variability. The [protocol](../../proof-protocol.md) explains the separate qualification, workflow and future-policy roles, family/query/reference exclusions, repeats, stopping rules and human evidence gate.

Verify the paired development export without constructing a provider or making reservations:

```sh
npm run proof:verify -- --verify docs/evidence/workflow-engineering-2026-10-17/development-proof-v1.json
```

The isolated demo additionally evaluates an actual 13-operation deliberately defective blanket-abstention policy and rejects it while preserving the baseline. The separate policy rehearsal verifies candidate capture during an in-flight question, later released instructions, rollback and unchanged original receipts. These are scripted mechanics, not policy-quality results. The [walkthrough and screenshots](../../product-workflow-demo.md) retain that distinction alongside a separate read-only historical live case.

## Preserved state

All **156 pre-existing evidence files** are byte-identical to the before-build manifest, including protected private stopped outputs. The canonical shared ledger remains **122 attempts, zero pending calls and zero owner rows**, with all original 102 rows unchanged. Reserved allowance remains $12.20 plus the unchanged $0.200281 prior adjustment, or **$12.400281 combined planning usage**, not provider charges. Raw private plans, approvals, receipts, journals, reports and local paths are excluded from this PR.

The failed October 16 qualification remains [separately recorded](../grader-qualification-live-approval-ux-2026-10-16/RESULTS.md). Its cohort is consumed and cannot be resumed or reused as fresh qualification after tuning. New v4 live checks remain hard closed; preparation, synthetic tests, hashes and self-authored plan JSON grant no qualification or dispatch authority. No environment settings, credentials, paid allowances, deployment or live activation changed during this build.
