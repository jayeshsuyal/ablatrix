# Prospective plan supersession

PR #30's bot found a shutdown-gate defect before execution: checking only port 4194 could miss the default port 4173 or a configured alternative. The original plan, qualification and preparation below remain unchanged and unused. **Zero provider calls were made against them.**

| Preserved original record | File SHA-256 |
| --- | --- |
| `offline-qualification.json` | `258c3497a7b3b96fba9f55402a799d6a4e5ff82ced82564d6b981f43e1cd4a41` |
| `execution-plan.json` | `e3bee995c2804f9a83139adca752924517de86c62a042ab05eb6f33b517d86f8` |
| `preparation.json` | `67f960e10b8a615d7c63622356a1ed4d668a7c41ae737b020f97700c2d2614d2` |

The corrected runner checks configured/default listeners, other processes holding the exact shared budget/review files, and app/loop PID locks. It records measured shutdown state; invalid locks or failed OS checks block execution before private output or provider creation. Existing pending-call, owner-lease and review-job gates remain in force.

The replacement [qualification](offline-qualification-v2.json), [preparation](preparation-v2.json) and [frozen plan](execution-plan-v2.json) were created prospectively. Qualified implementation commit: `2191ffbdc16738736138fbf8f25866e100ae0620`. Plan SHA-256: `262bfa97b93f7eb4bc9daf1986f8e1d55959475efaf9bce8b73a96cddada8642`. Thirteen focused tests, 281 full-suite passes plus one Linux-only skip, build, strict CLI typecheck and independent read-only review passed.

All three cases, ordered sources, original customer questions, critique, prompts, request/catalog/schema bodies, call order and limits are identical to the unused plan. Only the qualified shutdown implementation, qualification reference, timestamp and resulting manifest identity changed. The approved maximum remains six new attempts / $0.60 local planning allowance, ledger 81→87, with no web, retry, replacement, candidate arm, import or quality promotion. Operator execution binds the existing scope approval to this replacement hash.
