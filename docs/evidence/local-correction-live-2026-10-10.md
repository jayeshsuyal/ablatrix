# Two real correction attempts — October 10, 2026

**Result: mixed.** Both approved Sapiom Router calls completed and saved a new answer version. Q26 improved wording under AI review. Q63 used the stronger saved listing but remained unnecessarily evasive. **5/5 citation quotes match their source text; no new human judgment or measured quality gain is claimed.**

## Frozen plan and execution

The [October 10 plan](local-correction-walkthrough-2026-10-10.json) was saved before generation, after fixing the review finding that treated dimensions such as `12-inch` as model identifiers. Its SHA-256 is `8a0d36559d0214d6f0f2ec571ff7e3de9420e85cbf34c49b9821e5ec5123bb38`. All five case inputs and critiques are identical to the [October 9 plan](local-correction-walkthrough-2026-10-09.json), whose hash remains `30b61763299300b732797223b9d12be97a5800d9509fc07e652859be567beefe`.

The user approved the two prepared real attempts. A one-off local runner used the existing `AnswerRevisions` worker and `SapiomFeedbackProvider`, the configured private credential, and the existing shared ledger. It verified frozen inputs and code, allowed only the two exact request bodies, queued one job at a time, and made one attempt per case. Requests used `gpt-luna`; both responses identified `gpt-5.6-luna`. Saved requests and local receipts record the prompt version `answer-revision-v3-investigation`. Web search, page reads, and automatic retries were disabled.

The [saved execution packet](local-correction-live-2026-10-10.json) includes actual request bodies and their hashes, jobs, provider receipts, source snapshots, original-version references, returned answers, and mechanical quote checks. Authentication headers and credentials are absent. These are locally recorded receipts, not cryptographically authenticated provider statements. UTC receipt times fall on October 11; the run occurred on October 10 in America/Los_Angeles.

| Case | Saved worker outcome | Exact quotes | Input / output tokens | Queue to finished |
| --- | --- | --- | --- | --- |
| Q26: handle color | `ready`, new answered version | 3/3 | 1,665 / 252 | 3,511 ms |
| Q63: keg capacity | `needs_information`, new insufficient-evidence version | 2/2 | 1,799 / 310 | 3,544 ms |

Queue-to-finished time includes investigation and local processing; it is not isolated inference time or a latency-reduction comparison. Total reported usage was **4,026 tokens**. The shared ledger moved **61 → 63 attempts**, reserving **$0.20 additional planning allowance** and **$6.30 cumulative allowances** within the existing $10 plan (plus the configured $0.200281 prior-spend input). These are local planning amounts, not settled charges or a provider-enforced cap; actual charges remain unavailable.

Both receipts have `status: completed` and no error code. Q63 returned a valid `insufficient_evidence` answer, so the worker saved it as `needs_information`. The runner preserved that result and stopped its expected-`ready` check. The packet's `status: stopped` therefore does **not** mean a transport, schema, or citation failure. No retry followed.

## Q26 — wording improved, small remaining issue

Original:

> The available evidence describes the handle as white to off-white/light gray, not pewter. One customer specifically says it is lighter than their pewter washer, so the photo or description may not precisely represent the shade. The exact manufacturer color is not confirmed by the supplied evidence.

Returned revision, unchanged:

> Customer descriptions identify the handle as white, off-white, or light gray, and one comparison says it is lighter than a pewter washer. The exact shade is not confirmed, so the listing may show a different-looking color than the replacement handle.

Independent **AI-only, non-blind assessment**: the revision removes repetitive evidence framing, attributes the color descriptions to customers, and retains uncertainty. The three cited customer spans support white, off-white/light gray, and lighter than pewter. The closing speculation about how the listing looks is unnecessary; no image was examined. This is a modest wording change, not a demonstrated correctness gain or a human preference result.

- Job: `ada3b969-c944-415a-acbf-1fbec476efeb`
- Receipt: `3b30138a-6e56-4b31-aea1-21a93f3b4fb3`
- Version: `revision-ada3b969-c944-415a-acbf-1fbec476efeb`

## Q63 — stronger citation, excessive abstention

Original:

> No. The available product evidence indicates that two slim quarter kegs will not fit.

Returned revision, unchanged:

> insufficient_evidence: The product description lists one slim-pony (1/4-barrel) keg as an acceptable configuration and allows up to two sixth-barrel kegs, but it does not explicitly state whether two slim quarter kegs fit together. The available customer statements are opinions rather than product documentation. Please provide the exact model number or compatibility documentation confirming whether two slim quarter kegs are supported.

Independent **AI-only, non-blind assessment**: the model now cites description 595's explicit capacity configurations rather than relying only on a tentative customer opinion. It correctly preserves the distinction between a listed configuration and independently tested physical fit. However, it fails the intended usefulness/style criterion: it exposes a machine status in prose, asks for an exact model already present in the supplied product title, and declines to state the straightforward supported conclusion that two slim-quarter kegs are not a listed configuration. Better source use did not yield a clean answer improvement.

- Job: `29abc0a1-e821-4fb8-98aa-dc08703f1c66`
- Receipt: `428a7a1f-26fc-47b4-8e3a-2895cb58b2f2`
- Version: `revision-29abc0a1-e821-4fb8-98aa-dc08703f1c66`

## Interpretation and next build target

This run isolates a useful engineering observation: the stronger Q63 source reached the model and was cited, yet the answer remained weak. The next narrow change should improve generation guidance for documented capacities, avoid asking for already-supplied identifiers, and keep status values outside customer-facing prose. Preserve wrong-model and genuinely missing-compatibility stops, including Q47. No additional paid experiment or policy promotion is part of this record.

A possible editorial target for Q63 is: “Two slim-quarter kegs are not a listed supported configuration. The listing specifies one slim-quarter keg, or up to two sixth-barrel kegs.” **This is an AI-written target, not a generated or human-approved result.**

The selected cases were already examined development examples. Their original generations lacked the later-restored customer-question context; the revisions also received critiques and a different prompt. This is not a fresh, blind, controlled ablation and cannot establish a population improvement rate or isolate a causal effect.

Q75 remains unchanged; Q19 reuses its historical correction; Q47 retains its [zero-call missing-information stop](local-correction-stop-2026-10-09.json). Every pre-existing answer, job, review, and call receipt was preserved. The two new feedback events are explicitly `ai_assisted`, not human judgments. Context-aware human review remains pending. Localhost was restored and checked with live generation and web discovery disabled.
