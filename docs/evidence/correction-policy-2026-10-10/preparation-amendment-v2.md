# Prospective preparation amendment v2

The [first prepared cohort](cohort.json) failed its [manual audit](manual-family-audit.json) **before any original answer, revision, or paid call for that cohort**. It remains unchanged and must not be dispatched. The final retrieval/execution manifest had not been frozen.

Two eligibility defects were found by inspecting question/source metadata:

1. A question about a battery's thermal fuse was classified as model compatibility because it contained the descriptive word “replacement” and the measurement “6-volt.”
2. A seat-protector question targeted a Ford F150, also targeted by a protected final-cohort product. The first audit only compared product-title identifiers and missed the question's identifier.

V2 excludes generic measurements from model identifiers, requires an explicit relationship such as “fit,” “work with,” or “replacement for,” and checks requested model identifiers against protected **question and title** identifiers. It also prevents repeated target identifiers across selected cases. The manual audit checks broader brands, product families, and source provenance after the automated checks.

The seed, eight-product strata, fixed critique, full-source rule, model, revision variants, and maximum 24 fresh attempts remain unchanged. All eight selections are rerun deterministically; this is an eligibility repair before outcomes exist, not selection based on a model's performance. The first files are preserved, and new records use `cohort-v2.json` and `manual-family-audit-v2.json`. Any further unresolved audit finding stops dispatch. This amendment adds no paid allowance and makes no quality claim.
