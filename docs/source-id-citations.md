# Server-resolved citations

The `source_ids_v1` interface is implemented for explicitly selected comparison runs. The model selects IDs from a frozen source list. The server reconstructs each citation from the corresponding literal source body. Historical formats and ordinary product-generation defaults keep their existing behavior; saved answers are not rewritten.

## The failure this addresses

The [previous live comparison](evidence/correction-policy-2026-10-10/report.md) stopped when an original-answer response cited the correct dimensions source but shortened its structured text. Exact-quote validation correctly rejected it. The older snippet helper also splits at periods, so decimal values and structured attributes can become fragments. That historical helper remains unchanged because saved experiment hashes depend on it.

The new interface offers one complete body per supplied source. It preserves spacing, decimals and repeated structured fields. Each ID binds the product, question and complete ordered source context, including original customer-question metadata and references. IDs from another context cannot be reused. Customer questions are metadata, never quotable proof.

The resolver rejects invented IDs, duplicate selections, unresolved ID markers and an `answered` response without a citation. Sources exceeding the bounds fail before reservation; no source is silently truncated or dropped. Limits are 12 sources, 3,000 characters per body, 12,000 body characters in total, and five selected citations per answer.

This prevents accepted citations from containing model-rewritten quotations. **It does not establish that a source supports a claim, that an answer is correct, or that a candidate is better.** Those remain separate review judgments.

## New comparison

`answerWithSourceIds()` and `reviseWithSourceIds()` are explicit opt-in methods. Both revision policies use the same citation interface, model settings, original answer, critique and retrieved context. Pure request helpers bind exact transport bodies; receipts retain the instruction identity, interface and offered-option hash. The comparison importer checks that original and revision citations match offered options exactly. Existing blinding and human-review requirements remain in force.

The [offline qualification](evidence/source-id-correction-2026-10-10/offline-qualification.json) passed 29 resolver/provider tests, including the exact failed 259-character dimensions source. All transports were injected synthetic responses. The full application passed 258 server tests with one Linux-only skip, its build, and four focused browser checks.

The separate [preparation record](evidence/source-id-correction-2026-10-10/preparation.md) and [execution manifest](evidence/source-id-correction-2026-10-10/execution-plan.json) freeze a new eight-product comparison, with five retrieved sources per case. All products from the stopped round, including its unattempted cases, are excluded. Any eligible prior preparation-only products are excluded too. Sixteen final revised answers would require independent human source checks; no quality gain or policy promotion follows automatically.

Frozen plan SHA256: `0d32ec0deba075cb3cf8ffa38fa0e96bc7288d03c834a0cdc8c5f00fcb0e128e`. Implementation commit: `6ce8e28278a91020acd72fa645078c025c1de0c7`.

A synthetic in-memory check covered all 24 request bodies: each original and both revision arms offer the same ordered citation catalog. All eight cases and 16 synthetic revisions imported with zero reviews, anonymous A/B labels, and locked results/exports. This checked packet wiring only; no provider was constructed and no live database was written. A mismatched approval hash was also rejected before provider construction or output/database creation.

The frozen retriever does not select every useful source: Q12820 omits the item-dimensions attribute, and Q11847 omits the customer-answer mismatch reports. Those records remain visible in the full review pool. This comparison tests correction prompts under fixed retrieval; it cannot establish retrieval completeness or coverage of every intended source conflict.

## Reproduce without calls

```sh
node --import tsx --test server/citation-options.test.ts server/feedback-provider.test.ts
node --import tsx scripts/source-id-comparison.ts --prepare --out /tmp/new-source-id-plan.json
```

Preparation uses the audited source cohort and the existing local hybrid retriever. It writes a new file, without opening provider credentials or live/review ledgers. Preparation timestamps and the recorded checkout commit can change the plan hash; use the saved immutable manifest for an approved execution. Original request hashes are frozen before generation; revision bodies depend on the shared original and are reconstructed and hashed before their own dispatch.

**No new paid call was made in this implementation slice.** The proposed next run is 24 attempts and $2.40 in local planning allowances, moving the shared ledger from 73 to at most 97. This exceeds the preceding 93-attempt approval. Its manifest records `paidExecutionAuthorized: false`; execution requires a separate approval naming that plan, explicit live opt-in, and a matching call limit. The existing $10 planning cap still applies; allowances are not settled provider charges. Unknown or invalid responses stop the run without retries or replacement cases.
