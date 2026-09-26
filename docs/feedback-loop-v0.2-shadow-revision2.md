# Exploratory policy replacement: two-case read

On September 25, 2026, we replaced the baseline policy's broad abstention sentence with an instruction to answer supported parts, label listing claims, and withhold disputed conclusions. This was a second development-only behavior check. It did not enter the official feedback loop, change the live baseline, or use final cases.

The two fresh Sapiom calls used `gpt-5.6-luna` and each case's exact saved retrieval passages. The baseline answers were historical, so this is not a randomized paired evaluation. [The saved packet](evidence/feedback-v02-shadow-policy-revision2-2026-09-25.json) contains the complete prompt, answers, citations, usage, and retrieval hashes.

For the cabinet question, the candidate clearly says the listing specifies **engineered wood** and **glass**, while the wood species and independently verified glass composition remain unknown. This is a clearer partial answer than the baseline, but it still does not settle the shopper's “real glass” question. Its `answered` status alone is not evidence of a correctness gain.

For the Native Union question, the candidate says the listing claims Native Union and explicitly reports the contradictory genuine and knockoff reviews. It does not guarantee authenticity. However, its `answered` status may imply more certainty than the evidence permits for the shopper's actual question. That is a possible regression requiring human judgment.

Both calls completed with exact quotes present in the saved passages. Together they used 1,547 input and 690 output tokens. The shared local ledger now has 15 planned calls and $1.50 in planning allowances against the approved $10 cap; actual provider charges are unavailable. No human reviews have been saved. The result is **inconclusive**: do not promote this wording or claim a measured quality improvement. The next decisive step is independent source-grounded human review of the development answers, followed by the frozen blind validation protocol if a failure is confirmed.
