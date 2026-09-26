# Development answer review: AI draft

Batch: `3c53c6ba-5e16-47b5-8161-6ba9d6319e28`. Model: `gpt-5.6-luna`. Policy: `live-baseline`. These are AI assessments from the frozen live answers and all 234 local passages belonging to their ten development products. Existing reference-answer guidance was not used as ground truth. No validation or final cases were reviewed.

The [review packet](evidence/feedback-v02-ai-development-review.json) preserves every model answer, judgment, rationale, confidence, checked source excerpt, passage hash, and a hash of the reviewed source snapshot. Nine answers appear correct and supported. One is a medium-confidence suspected unnecessary abstention. These draft judgments do not establish a human accuracy score or a measured feedback gain.

| Case | Question/topic | AI judgment | Why |
| --- | --- | --- | --- |
| 349 | Canvas panel quantity | Correct and supported | Package reports and piece-count attribute agree on 12. |
| 416 | Roll length unit | Correct and supported | Attribute and bullet identify 200 feet. |
| 438 | Thread weight | Correct and supported | Listing specifies 40 weight. |
| 743 | Inseam variant | Correct and supported | Selected item's attribute says 10 inches; other available variants are distinguished. |
| 770 | Bottle pockets | Correct and supported | Internal pocket and absent external pockets are distinguished. |
| 775 | Cabinet wood and glass | Suspected unnecessary abstention; medium confidence | Listing identifies engineered wood and glass; answer treats glass as unconfirmed and labels the whole response insufficient evidence. |
| 585 | Verizon LG G2 case | Correct and supported | Listed variant and VS980 report support compatibility; contrary customer report is disclosed. |
| 728 | Waterproof fabric | Correct and supported | Description and reviews support the listing claim; answer does not invent a certified rating. |
| 647 | Handset authenticity | Correct and supported abstention | Conflicting genuine/knockoff reports prevent an authenticity conclusion. |
| 635 | Galaxy S3 cradle fit | Correct and supported | Compatibility attribute supports likely fit; bulky-case limitation is preserved. |

## The proposed correction to inspect

For case 775, the material attribute says:

> material: { value:"engineered wood" }; { value:"glass" }; { value:"metal" }; { value:"plastic" }

The source's precise formatting and full quote are preserved in the JSON packet. Customer reviews describe pressed wood and particle board, with one contradictory "real wood" report. The original answer already reports engineered wood correctly, then says the glass entry does not establish whether it is real glass. A more useful source-relative answer would be:

> The listing identifies engineered wood and glass. Reviews describe pressed wood or particle board with a wood-grain paper overlay. The wood species and exact glass composition are not specified, and one customer's description of real wood conflicts with the other evidence.

The draft marks the original answer incorrect for adequacy, with its quoted product facts supported. This judgment is debatable: "real glass" might ask for physical verification beyond the historical listing. A human reviewer should decide whether the conservative wording is a material failure before using it to change the policy. The baseline may score 10/10 if that judgment is rejected; no failure should be invented to force a successful optimization demo.

## Hypothesis for a later candidate

Assess each requested attribute separately. Report explicit listed materials or specifications as listing claims, retain relevant conflicts, and limit abstention to the unresolved part. Distinguish reporting a listed specification from guaranteeing product authenticity or physical verification. This is an untested policy hypothesis, not an active candidate or a measured improvement.

Case 647 is an especially useful regression check: a change that fixes over-abstention on cabinet materials must preserve justified abstention on disputed authenticity. Human-confirmed development reviews are required before a Sapiom policy proposal can be generated. Validation and final review retain their existing human gates.

## How to finish the review in the app

The live saved-answer queue displays **AI draft ready**. Each draft shows its suggested judgments, rationale, confidence and source excerpts. **Use suggested judgments** copies editable judgments and notes only. The human reviewer must personally select checked sources, confirm the evidence check and provide a reviewer name. Saving records both the human reviewer and the draft's ID, preserving the fact that the review had AI assistance. A draft alone cannot feed a proposal or satisfy a promotion/report gate.
