# GPT-6 Astra blind validation review: calibration revision 2

A separate GPT-6 Astra reviewer at high reasoning effort read only the [anonymous review sheet](answer-calibration-revision2-validation-blind-review-2026-09-25.md) with complete product evidence. It did not see arm identity, the candidate policy, call metadata, or prior results. This is an **AI assessment**, not human review or an official promotion score.

| Fresh product question | Answer A | Answer B | Blind preference | Arm reveal |
| --- | --- | --- | --- | --- |
| iPhone 4S case fit (`epqa-dev-535`) | Support, adequacy, citations: pass | Support, adequacy, citations: pass | A, narrowly | A = baseline; B = candidate |
| Droid Turbo armband fit (`epqa-dev-587`) | Support, adequacy, citations: pass | Support, adequacy, citations: pass | A, narrowly | A = candidate; B = baseline |

For the iPhone 4S case, both answers are supported and directly answer yes. The baseline's explicit customer report of iPhone 4S fit better addresses the question. Its extra manufacturer-specification caveat is unnecessary but not a material failure. The candidate instead highlights an iPhone 4 report; that report supports its attributed claim but is less responsive to the iPhone 4S concern. The listing and other supplied passages support fit for both models.

For the Droid Turbo armband, neither answer asserts an unsupported fit verdict. The evidence lacks Droid Turbo compatibility and dimensions for a reliable comparison. The candidate more clearly attributes the generic purchasing advice and was narrowly preferred. The baseline's “iPhone-specific” shorthand is imprecise because the compatibility list also includes iPod touch models; its non-iPhone recommendation comes from a customer response to an HTC question and is weak evidence for this particular phone.

**Sources checked, iPhone 4S:** `epqa-B005SWX65G-cqa-5c96e4f36cfde5f9`, `epqa-B005SWX65G-review-9ed7e4c0d13518f8`, `epqa-B005SWX65G-cqa-fdef6b6aa5212cad`, `epqa-B005SWX65G-attribute-62e8757b539d9d6f`, and `epqa-B005SWX65G-review-2a5b56a4de0517c6`.

**Sources checked, Droid Turbo:** `epqa-B009XGZGZG-cqa-156f07dabe81b8ab`, `epqa-B009XGZGZG-review-5ab01fad0bbd9399`, `epqa-B009XGZGZG-attribute-6f6346f16723c9e2`, `epqa-B009XGZGZG-attribute-de5e7a1e3aea33ec`, and `epqa-B009XGZGZG-cqa-f7562a2d3cd19f12`.

All four saved answers passed mechanical exact-quote membership and returned `gpt-5.6-luna`. The candidate marked the Droid Turbo response `answered` while stating that fit was uncertain; that status is not counted as a correctness gain. Both arms had two AI-assessed passes on each rubric axis, and each was narrowly preferred on one case. **No supported-correctness improvement was observed.** These two purposively selected products and AI judgments cannot establish a general quality effect. Both fresh validation products are consumed for this exploratory record. The active `live-baseline` policy remains unchanged; no official candidate was promoted.
