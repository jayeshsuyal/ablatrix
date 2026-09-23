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
| Review bench design follow-up | Paired case review with progressive evidence detail, readable responsive states and browser coverage | Draft: #9; fixture implementation and tests complete in branch; live acceptance pending credential, spending cap, and provider contracts |

Each slice needs tests, build, review, merged-main verification, and a smoke test. Fixture observations never count as live benchmark evidence. Paid acceptance requires credentials, a numeric cap, a verified remote spending rule, and a supported settled charge source for both agent and Router calls.
