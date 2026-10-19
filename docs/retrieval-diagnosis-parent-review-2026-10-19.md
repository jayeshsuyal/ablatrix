# Retrieval diagnosis: parent review and repairs

October 19, 2026 · [PR #50](https://github.com/jayeshsuyal/ablatrix/pull/50)

**The additive candidate delivers 12/13 designated source units on the exposed development deck, versus baseline’s 10/13. No new answer has been generated, so answer-quality improvement remains unmeasured.** The ordinary application retrieval and answer policy remain unchanged.

## What the review changed

- Removed execution IDs and arm bindings from anonymous reviewer answers. Public review objects contain only neutral labels, answer/status and citations; the arm mapping stays separate and private.
- Required source identity and original-question scope when matching designated units in every arm. An identical quote under an unrelated model question cannot satisfy the gate.
- Replayed actual FTS5, scope promotion, fusion, selection and semantic selection from saved dense cosines/logits. Mutation tests reject changed rankings, decisions, contexts and delivery. Saved scores are replay inputs; this does not independently authenticate or recompute model scores.
- Pinned the exact independently replayed v5 result path and raw SHA-256, plus its [mechanical review record](evidence/retrieval-diagnosis-2026-10-19/semantic-supplement-v5-reviewed-result-v1.json), before promoting any saved candidate context. An arbitrary complete-source append is rejected even when the freeze and metadata remain valid. All twelve replayed rows and the full result match after excluding only runtime resource observations; original observations remain protected by the raw file hash.
- Bundled 30 exact historical v2 code files and bound 91 public artifacts. Historical replay now works without Git ancestry, ignored work files or model downloads. Original frozen code and results remain unchanged.
- Added an actual local live CLI around the existing provider and canonical planning ledger: offline preparation/verification, exact-plan approval, explicit live opt-in, byte bindings, exclusive private output, durable checkpoints, no retries or resume, and read-only receipt recovery. Mocked tests establish mechanics, not live quality.

## Source-delivery result

All twelve products were exposed by the unsuccessful v2 study. They are now development data; none is fresh validation. The thirteen designated units include scoped customer reports and conflicting observations, not thirteen independently correct product facts or a complete customer-answer rubric.

| Context | Designated units delivered | Interpretation |
| --- | ---: | --- |
| Historical baseline | 10/13 | Complete parent context restored from baseline selection |
| Original semantic replacement v3 | 1/13 | Negative result retained |
| Question-first semantic replacement v4 | 4/13 | Torch improves, but controls regress |
| Additive semantic v5 | 12/13 | All twelve baseline prefixes retained; no designated-unit regression |

The torch question is unchanged: “hi, once filled how long do they last on average?” Relevant parents entered fusion at ranks 7, 9 and 10 but were dropped by the five-chunk selection limit. V3’s verbose query/document formatting also produced poor relevance scores. V4 froze question-first query input and literal document text before its full twelve-case run; model, floor and MMR were held constant. It recovered two torch reports but replaced useful baseline context elsewhere.

V5 therefore preserves each baseline parent, body, order, rank and original-question scope, adding at most three qualifying v4 parents within eight parents and 12,000 body characters. It reuses the exact query/document-bound v4 logits. It restores the listing’s more-than-six-hour claim and the customer’s five-to-six-hour report. The nearly-eight-hour report remains below the semantic floor. That report describes manual extinguishing, not measured fuel exhaustion. These sources support attributed observations; they do not establish a population average.

There are zero empty v5 contexts and zero baseline designated-unit regressions across the twelve cases. Only the torch case gains designated units. V5 was designed after observing v4 regressions. This is an exposed development improvement, not an unbiased success rate. Saved replay timings measure context assembly, not inference or answer latency. No cost reduction is established.

### Evidence and reproducibility

- [V4 prospective input freeze](evidence/retrieval-diagnosis-2026-10-19/semantic-input-v4-freeze-v1.json) and [cached-model development run](evidence/retrieval-diagnosis-2026-10-19/semantic-input-v4-development-v1.json).
- [V5 current freeze](evidence/retrieval-diagnosis-2026-10-19/semantic-supplement-v5-freeze-v2.json) and [full twelve-case result](evidence/retrieval-diagnosis-2026-10-19/semantic-supplement-v5-development-v2.json).
- [Test-type amendment](evidence/retrieval-diagnosis-2026-10-19/semantic-supplement-v5-test-types-amendment-v1.json): preserves the original fixture bytes and v1 freeze/result. V2 changes only a test annotation/import, with identical emitted JavaScript; candidate/runtime/input/threshold behavior is unchanged.
- [Historical v2 code bundle](evidence/retrieval-diagnosis-2026-10-19/frozen-v2-code-bundle-v1.json). The original v2/v3 negative results remain intact.

After `npm ci` with Node 24.10+, run:

```sh
npm run diagnosis:replay
npm run diagnosis:v5 -- /private/tmp/ablatrix-new-v5-replay.json
npm run diagnosis:mock
npm run diagnosis:live
```

Choose a new output filename. Saved replay needs no Git history, ledger, credential or model cache. It checks calculations against saved model scores. Recomputing local model scores is a separate explicit cached-model workflow documented in the [original diagnosis](retrieval-diagnosis-2026-10-19.md). The mock generates three synthetic responses through mocked transport, making zero real provider calls. The last command prints CLI usage.

## Actual execution readiness

The local preparation driver retains all independently designated gap cases rather than filtering for candidate successes. This deck has one eligible gap case; its current, additive and separately reviewed reference contexts are prepared with identical generation instructions. Source review is AI-only, and the reference’s qualifications and unknowns remain attached.

Offline preparation and actual CLI verification succeeded with **`codeReviewPassed: false`, `stopReason: code_review_pending`, `budget: null` and zero provider calls**. This is a preparatory wrapper, not an approved paid plan. The reviewer must inspect the latest code before a new wrapper can enumerate an exact proposed budget. Any later live run requires explicit financial approval for that exact scope; prior approvals are not reused.

The canonical ledger remains at 138 attempts, $13.80 reserved plus $0.200281 prior adjustment = **$14.000281 local planning usage**, zero pending/owners under the existing $20 cap. No credential or environment file was read. Planning allowances are not settled provider charges or a provider-enforced cap. No paid generation/grading/web call, retry, deployment or activation occurred.

## Verification and remaining work

Initial parent verification: **665 server tests passed, one platform skip; 66 Python tests passed; production build and standalone script types passed.** Focused checks include 18 replay-mutation tests, two historical-code replay tests (including a checkout with no `.git`), six v4/v5 tests, twelve diagnostic/live-boundary tests and four preparation-boundary tests. CI runs saved replay, v5 replay and mocked transport without paid calls.

Next, finish review on the exact PR head. A reviewed, separately approved three-context answer diagnostic on this exposed case can distinguish retrieval from generation failure. It still cannot establish general quality improvement. A later candidate must be frozen before selecting fresh product/family/source-disjoint cases, with reference completeness and scope checked before generation. The next-protocol packet-overlap guard exists but must be integrated into that selector before a fresh cohort is accepted. AGENTS.md requires source-checked human review and fresh product-disjoint improvement for final answer-quality claims or promotion; neither is supplied by this source-delivery result.

## CI and bot-review follow-up

CI on `461c970` exposed a macOS/Linux SQLite difference of one or two binary64 steps in raw BM25 scores. Saved replay now allows at most four steps for those raw observations only; ordered source IDs, ranks, fusion, selection, decisions and literal contexts remain exact. The actual CI values are regression inputs; larger drift and changed identities/order/ranks still reject. No model, source, selected context or result artifact changed.

The bot also found that valid input/code hashes alone did not authenticate generated v5 output rows. The fixed-scope preparer now accepts only the exact official raw result and its separately pinned review record. Editing output or the review record, appending an otherwise literal same-product source, or choosing another file stops before contexts can enter a paid preparation. The parsed snapshot used for contexts must equal the result decoded from the pinned bytes; freeze metadata is also decoded from the same bytes whose hash was checked. The review record is included in execution artifact bindings. This is an integrity check on exposed development output, not fresh validation or answer-quality review.

Follow-up verification: **668 server tests passed, one platform skip; production build, strict changed-file types and saved replay passed.** The replay and preparation boundary suites contain 19 and six checks respectively. The existing 66 Python passes remain applicable; their code and frozen inputs are unchanged. Refreshed actual-CLI preparation and verification still stop at pending code review with a null budget and zero provider calls; canonical ledger totals remain unchanged.
