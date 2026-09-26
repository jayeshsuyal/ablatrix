# Exploratory policy behavior check: 2026-09-25

The saved development batch still has zero human reviews. The AI draft for cabinet materials suggested that the baseline abstained too broadly. We tested that hypothesis on two existing development questions using a generic candidate instruction appended to the frozen baseline policy. This was an exploratory behavior check; the candidate was not entered into the official feedback loop or promoted.

The two candidate calls used Sapiom `gpt-5.6-luna` with each case's exact saved retrieval passages. The original baseline answers were historical, so this is not a randomized, contemporaneous comparison. The local ledger reserved two calls at a $0.20 total planning allowance. Actual Sapiom billed cost is unavailable. [The saved packet](evidence/feedback-v02-shadow-policy-2026-09-25.json) contains the candidate instructions, questions, both answers, citation IDs, model usage, and retrieval snapshot hashes.

| Development case | Baseline | Candidate | Reading |
| --- | --- | --- | --- |
| Cabinet wood and glass (`epqa-train-775`) | Insufficient evidence | Insufficient evidence | Candidate states that the listing names engineered wood and glass, then still withholds a conclusion about physical glass composition. Four candidate citations have exact passage quotes. The intended abstention change did not occur. |
| Native Union authenticity (`epqa-train-647`) | Insufficient evidence | Insufficient evidence | Candidate preserves caution because customer reports disagree on authenticity. Four candidate citations have exact passage quotes. |

Candidate usage totaled 1,525 input and 596 output tokens. Both calls completed; neither is a human quality score. This check gives no evidence of answer-quality improvement. It does show that a small policy wording change alone did not flip the disputed cabinet answer. A human reviewer must decide whether the baseline cabinet response is actually a failure before spending validation questions or promoting any policy.
