# Six PR build plan and evidence ledger

| Slice | Acceptance criteria | Status |
| --- | --- | --- |
| PR1 Baseline | Research contract, durable runs, fixture and Sapiom paths, connected baseline UI | Merged: #1, `7ebf32e`; CI and local smoke pass; live pending |
| PR2 Evaluation | Versioned curated tasks, rubrics, held-out evaluation, honest quality views | Merged: #2, `60a9811`; CI and browser smoke pass |
| PR3 Runner | Persistent bounded candidate jobs, cancellation, retries, recovery | Merged: #3, `6b1eeb5`; CI and browser smoke pass |
| PR4 Optimizer | Structured bounded proposals, deterministic checks, comparison and no-improvement | Merged: #4, `142751f`; CI and browser smoke pass |
| PR5 Dashboard | Responsive real-data views and reproducible redacted export | In progress |
| PR6 Release | Browser E2E, restart/security checks, docs, release evidence | Pending |

Each slice needs tests, build, review, merged-main verification, and a smoke test. Fixture observations never count as live benchmark evidence. Live acceptance needs credentials and an approved spend cap. GitHub PRs require a private `ablatrix` remote and working authentication.
