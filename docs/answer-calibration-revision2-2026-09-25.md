# Answer calibration revision 2: frozen exploratory plan

Revision 1 passed exact-quote execution checks but failed its development answer-adequacy gate. This round tests one revised generic policy on the same **already-used development** questions before deciding whether to spend calls on fresh validation products. It is AI reviewed, not an official human-scored validation or a policy promotion.

## Intervention

Use the same `gpt-luna` Sapiom Router lane, saved product-filtered retrieval, and server-provided quote IDs as revision 1. Reuse revision 1's saved baseline answers as development controls; their original model identity, quote interface, and retrieval hashes must match. The new candidate alone requires two development calls. The candidate policy is frozen before dispatch:

> Answer the selected product question using only the supplied evidence. Cite exact supporting quotes and passage IDs. Answer each separately requested fact at the level the strongest relevant source supports, and explicitly attribute listing or manufacturer claims and customer reports. If a listing directly states a material or feature, report that fact as a listing claim in a clear affirmative sentence; do not turn it into an unresolved answer merely because the delivered item was not independently inspected. Add a physical-verification caveat only when the question explicitly asks for independent verification or supplied evidence directly disputes the listing, and keep that caveat separate from the listing claim. Reconcile compatible descriptions, including a general material category and a more specific subtype; call sources conflicting only when their claims cannot both be true at the same level. When sources genuinely conflict about a narrower claim such as physical authenticity, explain that specific uncertainty while preserving any supported listing identity. Use insufficient_evidence only when no requested part has a supported answer. Never invent specifications, infer component mapping or physical authenticity from a listing alone, or transfer evidence between products.

The policy contains no product names, case IDs, or answer text. The revision specifically removes revision 1's blanket physical-authentication caveat and makes the compatibility rule more operational.

## Three-axis review and gate

GPT-6 Astra will read an anonymous source-grounded sheet and judge each answer separately on **claim support**, **answer adequacy**, and **citation relevance**. Exact quote membership is checked mechanically. Model status is not a quality score. The development gate passes only if the candidate clearly states each listing-supported cabinet material, qualifies only genuinely unresolved details, does not mislabel compatible wood descriptions as conflict, and has no material support or adequacy regression on the Native Union authenticity control. A preference alone does not pass the gate.

If the gate passes, freeze two unused product-disjoint validation questions and make four new paired calls, baseline and candidate with identical newly saved retrieval and quote-ID interface. Those products are consumed in the exploratory record even if an attempt fails. Astra may review the resulting anonymous pairs, but no result satisfies the existing human review gate or promotes a policy. If development fails or any call is uncertain, stop; do not spend fresh validation products.

Shared local ledger before this round: **31/60 attempts**, **$3.10 cumulative planning allowances**. Development adds at most two $0.10 allowances; conditional validation adds at most four. Actual provider-billed charges are unavailable. The original failed and restarted revision 1 packets remain immutable.

## Development outcome and pre-validation presentation amendment

Both new candidate calls completed with exact-quote membership, moving the shared ledger to **33/60 attempts** and **$3.30 cumulative planning allowances**. [Astra's blind AI review](evidence/answer-calibration-revision2-astra-review-2026-09-25.md) found the candidate cabinet answer adequate and source-grounded, and the Native Union candidate showed no material regression. The [development gate](evidence/answer-calibration-revision2-development-gate-2026-09-25.json) therefore passes for exploratory progression. This is a reused-development judgment, not a quality estimate.

The candidate cabinet answer included internal quote-ID markers in its prose. After the blind read and before selecting any validation case, the common snippet-ID provider was changed to strip only bracketed IDs that occur in its structured citation list, reject unresolved IDs, and retain the raw model answer in the experimental packet. The same output cleanup applies to both validation arms. The raw development packet is unchanged. This is a disclosed presentation amendment; no factual content or answer policy was edited after the review. The provider test, all 90 tests, and production build pass.

## Fresh validation outcome

Two unused product-disjoint questions were frozen, then four live paired calls completed under identical saved retrieval within each pair. All four passed exact-quote execution checks. Both products are consumed for this exploratory record. [Astra's blind source review](evidence/answer-calibration-revision2-validation-astra-review-2026-09-25.md) passed all four answers on claim support, shopper adequacy, and citation relevance. It narrowly preferred the baseline on the iPhone 4S case and the candidate on the Droid Turbo armband case. Thus there was **no observed supported-correctness gain** or net blind preference in this two-product sample. The model's differing `answered` status on the armband did not change its uncertain answer and is not a quality gain. No human review, official promotion, or final holdout run occurred.

The shared ledger is now **37/60 attempts** and **$3.70 cumulative planning allowances**. Actual provider-billed charges remain unavailable. `live-baseline` remains active. Two originally unused validation products remain for a different future protocol; the two used here must not be reused as fresh cases.
