# Six PR build plan and evidence ledger

| Slice | Acceptance criteria | Status |
| --- | --- | --- |
| PR1 Baseline | Research contract, durable runs, fixture and Sapiom paths, connected baseline UI | Merged: #1, `7ebf32e`; CI and local smoke pass; live pending |
| PR2 Evaluation | Versioned curated tasks, rubrics, held-out evaluation, honest quality views | Merged: #2, `60a9811`; CI and browser smoke pass |
| PR3 Runner | Persistent bounded candidate jobs, cancellation, retries, recovery | Merged: #3, `6b1eeb5`; CI and browser smoke pass |
| PR4 Optimizer | Structured bounded proposals, deterministic checks, comparison and no-improvement | Merged: #4, `142751f`; CI and browser smoke pass |
| PR5 Dashboard | Responsive real-data views and reproducible redacted export | Merged: #5, `031522c`; CI and browser smoke pass |
| PR6 Release | Browser E2E, restart/security checks, docs, release evidence | Merged: #6, `5407b04`; CI and local smoke pass; paid acceptance pending |
| Corrective follow-up | Durable shared budget, metered orchestration test path, paired synthetic holdout, honest live readiness | Merged: #7, `dd7b0fd`; CI and merged-main tests/build pass; paid acceptance pending Sapiom charge and cap contracts |

Current audit follow-up on `codex/goated-demo`: live-report fixture isolation and full-history diagnostics, interrupted and malformed proposal recovery, and checked-source quote provenance are implemented locally. The branch passes 25 API tests, four Chromium browser tests, and a TypeScript/Vite build. The Sapiom agent has a pinned package and passes typecheck, Sapiom's graph check, and stubbed-run checks. A short Router connectivity request completed with 148 total tokens; its individual charge remains unknown. Agent build `2217` reached ready, and production run `728875` failed after three model-output parse errors. Sapiom displayed a settled $0.03 charge for that run. A local fix raises the model output limit, accepts validated JSON text when structured output is absent, and ends without retries on unusable output. It passes local checks but has not been redeployed. Paid acceptance remains gated on verified Sapiom charge and cap contracts.

Each slice needs tests, build, review, merged-main verification, and a smoke test. Fixture observations never count as live benchmark evidence. Paid acceptance requires credentials, a numeric cap, a verified remote spending rule, and a supported settled charge source for both agent and Router calls.
