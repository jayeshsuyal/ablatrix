# Answer calibration round: frozen plan

This exploratory, AI-reviewed round follows the citation diagnostic. It does not alter the saved official candidate, `live-baseline`, or the human review gate. The objective is to test one generic answer-policy change, not to promote it automatically.

## Review rubric

Judge each answer on three separate axes before seeing its arm:

1. **Claim support:** Are all material factual claims warranted by the supplied passages, with listing claims attributed as listing claims and customer reports attributed as reports? An incomplete answer can still have supported claims.
2. **Answer adequacy:** Does it answer each supported part of the shopper's question directly, while identifying only genuinely unresolved details? Mark over-abstention here, not as an unsupported claim unless the answer also asserts an unwarranted fact.
3. **Citation validity:** Do cited quote strings occur literally in the stated passage, and do those citations actually support the claims attached to them? Record exact-substring validity mechanically and semantic citation relevance by review.

The model's `answered` status is descriptive, not a correctness score. A pass on one axis does not imply a pass on another. AI judgments will be labeled as such; they cannot satisfy the application's human-reviewed promotion gate.

## Frozen intervention

Both arms use the same Sapiom `gpt-luna` answer model, `gpt-5.6-luna` response identity, server-provided quote IDs, frozen saved retrieval within each pair, and the same output checks. The control uses the active `live-baseline` instructions. The candidate uses this complete policy:

> Answer the selected product question using only the supplied evidence. Cite exact supporting quotes and passage IDs. Distinguish listing or manufacturer claims from customer reports. For each separately requested fact, state the most specific affirmative conclusion that a source directly supports, with its source type clearly attributed. Do not demand independent physical verification before reporting a listing claim as a listing claim. Treat descriptions as conflicting only when they cannot both be true; uncertainty about a narrower detail must not erase a supported broader conclusion. Qualify only the unresolved portion of the question, including physical authenticity or exact component composition when the sources do not establish it. Use insufficient_evidence only when none of the requested facts can be answered from the supplied evidence. Never invent a specification, imply a listing proves physical authenticity, or transfer evidence between products.

The policy contains no product names, case IDs, or memorized factual answers. It differs from the baseline only in how it separates supported facts from unresolved details.

## Sequence and stop rule

1. Run four development calls on the already-used cabinet materials and Native Union authenticity questions: control and candidate for each, with arm order alternated. Use each question's saved baseline retrieval. Preflight the shared local 60-call and $10 planning allowance. Checkpoint the manifest before dispatch and every result. Never retry an uncertain call automatically.
2. Have GPT-6 Astra read an anonymous source-grounded sheet containing the four answers and full product evidence. Development gate: the candidate must adequately state the listing-supported cabinet materials, keep uncertainty about unsupported component or authenticity claims, and show no material claim-support or adequacy regression on Native Union. A mere status flip or cleaner citation is insufficient. If the gate fails, stop with no fresh validation call.
3. Only if the development gate passes, freeze two previously unused, product-disjoint validation cases. Run control and candidate on the same newly saved retrieval for each. Record these products as consumed for this exploratory round even if an API call fails. Obtain anonymous Astra review under the same three-axis rubric. No human score or policy promotion is inferred from that review.

Development planning allowance: four calls × $0.10 = $0.40. Optional fresh validation allowance: four calls × $0.10 = $0.40. Existing shared ledger starts at 26/60 calls and $2.60 cumulative allowances; actual billed provider cost is unavailable. No final holdout product is used.

## Execution update

The first development attempt, the baseline arm on cabinet materials, failed before a verified model response was saved. Its ledger entry is `failed_or_unknown`; the provider's intentionally generic error does not distinguish a remote HTTP rejection from a transport or response-shape failure. A later unauthenticated HEAD request and Node GET reached the Sapiom endpoint, so persistent endpoint unreachability was not established. The attempted call may or may not have incurred a remote charge. The runner stopped without dispatching the three remaining planned calls and will not replay this packet. No fresh validation case was selected or consumed, no answer-quality gate was assessed, and no policy improvement is claimed. The shared local ledger now holds **27/60 attempts** and **$2.70 cumulative planning allowances**; actual billed charges remain unavailable.

The saved [development packet](evidence/answer-calibration-development-2026-09-25.json) records the failure and three unattempted slots. Validation is blocked by the missing passing development review gate. The candidate remains an untested exploratory policy; `live-baseline` remains active.

**Recorded restart amendment, after the failure:** A separate credentialed, non-generative Node connectivity check failed in the default sandbox with DNS `ENOTFOUND` and reached the endpoint outside the sandbox (HTTP 404 at an unsupported metadata route). This supports, but does not prove, a local DNS block as the first answer attempt's cause. The failed attempt stays counted as uncertain. One new, separately checkpointed four-call development batch may run outside the sandbox under the same frozen policy and $0.40 additional planning allowance. It is a deliberate restart, not a hidden retry of the saved packet. Any uncertain result in the restart stops the batch. Its [separate packet](evidence/answer-calibration-development-restart-2026-09-25.json) will be the only input to the development review gate; fresh validation remains closed until that gate passes. The original packet is never overwritten.

**Restart outcome:** All four development calls completed with exact quote membership, two on cabinet materials and two on Native Union authenticity. A separate [GPT-6 Astra blind assessment](evidence/answer-calibration-astra-review-2026-09-25.md) narrowly preferred the candidate cabinet answer but rated both cabinet answers only qualified on claim support, answer adequacy, and citation relevance. Both Native Union answers passed. The candidate did not satisfy the frozen cabinet adequacy requirement, so the [development gate](evidence/answer-calibration-development-gate-2026-09-25.json) is **failed**. No fresh validation call was made or validation product consumed. Five new attempts, including the original uncertain one, moved the shared ledger to **31/60 attempts** and **$3.10 cumulative planning allowances**. Actual provider-billed charges remain unavailable. The active policy is still `live-baseline`.
