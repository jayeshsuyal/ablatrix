# Repeated shutdown checks: prospective supersession

The [earlier supersession](plan-supersession.md) repaired port detection. PR #30's subsequent bot review found that its one-time check could miss an app starting afterward. Version 2's records below remain unchanged and unused; **zero provider calls were made against versions 1 or 2**.

| Preserved version 2 record | File SHA-256 |
| --- | --- |
| `offline-qualification-v2.json` | `3c194a70e69275203d2171a6aa12e598ca79776519ae75e8e4c78ed45dba3170` |
| `execution-plan-v2.json` | `3f5a79e5108c572dc28c0cf3e86cc02da230630c243e62bcfe8933bd9979edcf` |
| `preparation-v2.json` | `fff7cf98eb14d163ca2b8952a3700882eead0663b376da885295f2fa03345f62` |
| `plan-supersession.md` | `841572a8fdd437abd8a09977e456664c5248f7f7f52ffbb73d25363379c4362e` |

The runner now measures app activity and historical state before each reservation, immediately before transport and after each response. It checks stopped-app state, unchanged prior receipts and reviews, no active review jobs, and only this process/run's reservations and provider lease. A failed check is checkpointed with its phase and measured state; the attempted receipt remains and later dispatches stop. Synthetic restarts cover zero attempts, one reservation/zero dispatches, and one spent dispatch/no second request.

This is detection at request boundaries, not exclusive application ownership. An external process can start during an in-flight request; the response check stops later calls but cannot undo that spent attempt.

The replacement [qualification](offline-qualification-v3.json), [preparation](preparation-v3.json) and [frozen plan](execution-plan-v3.json) are prospective. Implementation: `9cba21c6ecf6cb700ac01a990a65576f0b83b293`. Plan SHA-256: `5239294ddec363335de2b176afa5df58ce16204ebbafeb31a976001c881a7164`. Verification passed: 16 focused tests, 284 full-suite passes with one Linux-only skip, build, strict CLI typecheck and independent read-only review.

Cases, full source contexts, critique, prompts, request/catalog/schema bodies, order and limits remain exactly equal to version 2 (and version 1). Only qualified runner/test code, qualification reference, timestamps and resulting identities changed. Approval remains six new attempts / $0.60 local planning allowance, ledger 81→87; no web, retry, replacement, candidate arm, import or quality promotion. Execution binds that existing scope approval to this version 3 hash.
