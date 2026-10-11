# Server-resolved citations

The subsequent [version 2 interface](constrained-source-ids.md) additionally declares each request's legal IDs in its response schema. Its [separate live diagnostic](evidence/source-id-diagnostic-2026-10-11/live-report.md) stopped at five of six planned attempts: four accepted outputs, 12/12 full-source matches and one rejected citation-container shape. This page records the historical version 1 comparison and its stopped outcome.

The `source_ids_v1` interface is implemented for explicitly selected comparison runs. The model selects IDs from a frozen source list. The server reconstructs each citation from the corresponding literal source body. Historical formats and ordinary product-generation defaults keep their existing behavior; saved answers are not rewritten.

## The failure this addresses

The [previous live comparison](evidence/correction-policy-2026-10-10/report.md) stopped when an original-answer response cited the correct dimensions source but shortened its structured text. Exact-quote validation correctly rejected it. The older snippet helper also splits at periods, so decimal values and structured attributes can become fragments. That historical helper remains unchanged because saved experiment hashes depend on it.

The new interface offers one complete body per supplied source. It preserves spacing, decimals and repeated structured fields. Each ID binds the product, question and complete ordered source context, including original customer-question metadata and references. IDs from another context cannot be reused. Customer questions are metadata, never quotable proof.

The resolver rejects invented IDs, duplicate selections, unresolved ID markers and an `answered` response without a citation. Sources exceeding the bounds fail before reservation; no source is silently truncated or dropped. Limits are 12 sources, 3,000 characters per body, 12,000 body characters in total, and five selected citations per answer.

This prevents accepted citations from containing model-rewritten quotations. **It does not establish that a source supports a claim, that an answer is correct, or that a candidate is better.** Those remain separate review judgments.

## New comparison

`answerWithSourceIds()` and `reviseWithSourceIds()` are explicit opt-in methods. Both revision policies use the same citation interface, model settings, original answer, critique and retrieved context. Pure request helpers bind exact transport bodies; receipts retain the instruction identity, interface and offered-option hash. The comparison importer checks that original and revision citations match offered options exactly. Existing blinding and human-review requirements remain in force.

The [offline qualification](evidence/source-id-correction-2026-10-10/offline-qualification.json) passed 29 resolver/provider tests, including the exact failed 259-character dimensions source. All transports were injected synthetic responses. The full application passed 258 server tests with one Linux-only skip, its build, and four focused browser checks.

The separate [preparation record](evidence/source-id-correction-2026-10-10/preparation.md) and [executed manifest](evidence/source-id-correction-2026-10-10/execution-plan-v2.json) froze an eight-product comparison, with five retrieved sources per case. All products from the previous stopped round, including its unattempted cases, were excluded. Eligible prior preparation-only products were excluded too. Sixteen final revised answers would require independent human source checks; no quality gain or policy promotion follows automatically.

Executed plan SHA256: `ce5c3d288781218dcf67e72ac77cbacb8c160e19a40384eaa2bf5d1722e489ee`. Implementation commit: `6be3416384059faf8f4efcdf61833287818af8d8`. The [prospective supersession record](evidence/source-id-correction-2026-10-10/plan-supersession.md) preserves the first plan version and explains the bot's model-alias correction. Historical plan file fingerprints bind their recorded implementation; they do not match the current checkout.

A synthetic in-memory check covered all 24 request bodies: each original and both revision arms offer the same ordered citation catalog. All eight cases and 16 synthetic revisions imported with zero reviews, anonymous A/B labels, and locked results/exports. This checked packet wiring only; no provider was constructed and no live database was written. A mismatched approval hash was also rejected before provider construction or output/database creation.

The frozen retriever does not select every useful source: Q12820 omits the item-dimensions attribute, and Q11847 omits the customer-answer mismatch reports. Those records remain visible in the full review pool. This comparison tests correction prompts under fixed retrieval; it cannot establish retrieval completeness or coverage of every intended source conflict.

## Reproduce without calls

```sh
node --import tsx --test server/citation-options.test.ts server/feedback-provider.test.ts
```

The historical preparer, `scripts/source-id-comparison.ts`, requires its recorded implementation commit and rejects changed file fingerprints before provider construction. Its frozen source cohort has already been exposed and is not a fresh validation set. Current regression tests reconstruct version 1 request bodies without executing the old round. Original request hashes were frozen before generation; revision bodies depended on the shared original and were reconstructed and hashed before their own dispatch.

The implementation and offline preparation made no paid calls. After separate user approval, [live execution](evidence/source-id-correction-2026-10-10/live-report.md) used eight of the 24 allowed attempts and stopped on an unknown citation ID. Seven outputs passed with 22 exact source-body citations; two of eight pairs completed, with no reduced import or human quality result. The shared ledger moved from 73 to 81, using $0.80 in local planning allowances; actual settled charges are unavailable. The immutable manifest's `paidExecutionAuthorized: false` records its preparation state, while the private execution record binds the later operator approval to its hash. The $10 planning cap remains in force. The unused 16 attempts do not authorize a retry or a new experiment.
