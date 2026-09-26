# GPT-6 Astra blind development review: calibration revision 2

A separate GPT-6 Astra reviewer at high reasoning effort read only the [anonymous sheet](answer-calibration-revision2-development-blind-review-2026-09-25.md), including full product evidence. Arm identity, policy instructions, answer status, and call metadata were hidden. This is an **AI assessment**, not a human judgment.

| Case | Answer | Claim support | Shopper adequacy | Citation relevance | Pair preference |
| --- | --- | --- | --- | --- | --- |
| Cabinet materials | A | Fail | Qualified | Qualified | B |
| Cabinet materials | B | Pass | Pass | Pass | B |
| Native Union authenticity | A | Pass | Pass | Pass | Tie |
| Native Union authenticity | B | Pass | Pass | Pass | Tie |

For the cabinet, A presents compatible pressed-wood and particle-board descriptions as conflicting. B instead reports engineered wood and glass as listing facts, treats those customer descriptions as compatible, and reserves its caveat for independent physical verification. B's caveat could be shorter, but the reviewer found it did not erase the listing claim. Both Native Union answers distinguish advertised brand/manufacturer from unresolved physical authenticity; neither shows a material regression.

The reviewer spotted internal quote IDs in cabinet B's prose: `[p5q1, p1q1, p4q2]` and `[p5q1]`. The associated structured citations were valid literal passages, but the text markers are not shopper-ready. The snippet provider now removes only bracketed IDs that are present in its selected structured citations and rejects any unresolved ID. It retains the raw model answer for experimental evidence. This deterministic output cleanup was added **after the blind development review and before any fresh validation call**; the semantic wording otherwise remains the same. The source-grounded judgment above applies to the raw answer; removing internal IDs does not add or change factual claims.

**Checked cabinet passages:** `epqa-B008402S3K-attribute-619f6c0d99b503d0`, `epqa-B008402S3K-review-33d481baf8c302dd`, `epqa-B008402S3K-review-2d3f6fc7e07606a5`, `epqa-B008402S3K-review-b70384bc8a4748d3`, `epqa-B008402S3K-review-87a352a6f9eba57e`, `epqa-B008402S3K-description-0e9583aa6726b7f9`, `epqa-B008402S3K-description-d6bf205c00b1928c`, and `epqa-B008402S3K-bullet-b473a0e7871b7bc8`.

**Checked Native Union passages:** `epqa-B003DKL4JA-attribute-7afbf30b240738bd`, `epqa-B003DKL4JA-attribute-7a1cda449e751d9d`, `epqa-B003DKL4JA-review-75e68c3a1f4d1e0d`, `epqa-B003DKL4JA-review-3caca617c0fd6348`, `epqa-B003DKL4JA-review-7637a46f0afa1f31`, and `epqa-B003DKL4JA-cqa-40546815d0dae28e`.

After the review, packet order reveals cabinet A = saved baseline, B = revision 2 candidate; Native Union A = revision 2 candidate, B = saved baseline. This reused-development screen supports proceeding to the frozen exploratory validation step, not a measured generalizable quality gain or policy promotion.
