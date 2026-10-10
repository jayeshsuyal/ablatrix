# Five cases through the local correction loop

This development walkthrough reuses saved live answers from the September 28 product batch. It is deliberately selected, AI-assisted, and not a fresh benchmark. Its critiques and expectations are development hypotheses; they are not saved human judgments. The original answers, historical reviews, and earlier revisions remain intact.

## The five cases

Use `/paid-review?qid=<number>` on your local app. The default port is 4173; an existing workspace may use a different port.

| Case | Purpose | Action | Success criterion to check |
| --- | --- | --- | --- |
| [Q75: stacked washer/dryer pads](http://127.0.0.1:4173/paid-review?qid=75) | Supported-answer control | Inspect the original; no generation or automatic acceptance | Preserve attribution to customer experience. Do not turn reports of use into a universal fit guarantee. |
| [Q26: handle color](http://127.0.0.1:4173/paid-review?qid=26) | Repetitive wording | Propose one revision with saved sources | Answer naturally, retain the reported white/off-white/light-gray variation and lighter-than-pewter comparison, and avoid inventing an exact manufacturer color or fit claim. |
| [Q63: kegerator capacity](http://127.0.0.1:4173/paid-review?qid=63) | Missed stronger source and useful detail | Propose one revision using the saved description | Explain the listing's one slim-quarter keg versus up to two sixth-barrel configuration and cite that description. The original “No” is not established as incorrect. |
| [Q19: refrigerator drawer](http://127.0.0.1:4173/paid-review?qid=19) | Wrong customer-question context | Reuse the saved September 29 before/after; no new call | Show removal of the claim that the part matches this questioner's model. Keep interchangeability with `241543917` unresolved. |
| [Q47: weather-station sensor](http://127.0.0.1:4173/paid-review?qid=47) | Genuinely missing information | Investigate saved sources with web discovery disabled | Ask for documentation of WMR200 compatibility. Exclude Q&A about other stations and make no answer call when no new applicable source exists. |

Q19's [saved revision](evidence/q19-live-revision-2026-09-29.md) and [later stopped investigation](evidence/q19-live-investigation-2026-09-29.md) are historical development observations. They used older prompt/routing versions. They are not a newly rerun case or a source-checked human acceptance.

Q63's original citation is a tentative customer opinion. Description 595 explicitly lists the acceptable keg configurations. This walkthrough tests whether the agent can use that already-saved source; it does not claim new source discovery or independent physical testing.

## Reproduce the preparation without calls

From the repository root, with Node.js 24.10+ and dependencies installed:

```sh
npm run walkthrough -- --out /tmp/ablatrix-correction-walkthrough.json
```

Choose a new output path for each run. The command verifies the pinned historical inputs, preserves original customer questions and citation mappings, and writes a hashed plan plus rule-based investigation traces. It does not read credentials, open the user's live ledgers, call a provider, enqueue live jobs, or submit judgments. Unexpected routing produces a failed preflight rather than silently changing the case or critique.

The trace checks Q26 and Q63 can reach generation and Q47 stops for information. Q75 stays unchanged; Q19 points to its existing record. These are routing checks, not model-quality results. The [saved preflight](evidence/local-correction-walkthrough-2026-10-09.json) records the inputs and outcomes for this implementation.

### Saved local worker result

Q47 was also submitted to the actual local revision worker with both live generation and web discovery disabled. Its explicitly AI-authored request ended at `needs_information`, requested documentation for WMR200 compatibility, and preserved the original answer: **zero provider calls, zero new answer versions, and zero human judgments**. The [saved worker record](evidence/local-correction-stop-2026-10-09.json) includes the plan hash, request, job, source decisions, and clarification. This verifies stopping behavior; it does not resolve compatibility.

Q26 and Q63 remain unexecuted pending approval of the two-call plan. Q75 has no automatic acceptance. Q19 uses the existing historical correction.

## Bounded live follow-through

The prepared plan proposes **at most two new answer calls**: one each for Q26 and Q63. No new baseline, Q19 regeneration, web search, or page read is needed. Each call reserves the existing $0.10 local planning allowance: **at most $0.20 additional planning allowance** inside the existing $10 plan. These amounts are not provider-enforced limits or settled charges.

Execution requires approval of that concrete plan and the existing local live configuration. The preparation command cannot enable or execute it. Use the existing durable revision worker, with `reviewKind: "ai_assisted"`, the frozen feedback, exact parent version, and an idempotency key bound to the plan. The worker's two-generation limit per answer remains in force; the proposed walkthrough allows at most one new attempt per selected answer. Preserve failed, invalid, and uncertain outcomes; do not automatically retry, replace cases, or increase the allowance. Stop the run on an uncertain dispatch.

Save the plan hash before dispatch, the exact new job/receipt/version IDs, investigation traces, selected sources, and every outcome. Keep the initial answers frozen. After generation, a person can inspect the versions and save their own source-checked decisions. No automated request should submit a human acceptance or a human quality verdict.

## What to record

- **Source support:** do the cited passages support the particular claims, within their original customer-question context?
- **Correctness:** does the answer address the requested product and relationship accurately?
- **Usefulness:** does it answer the supported part or ask a specific, necessary clarification? Wording preference is recorded separately.
- **Mechanical citations:** are quotes literal spans of the identified source bodies? This check cannot establish the first three points.
- **Operations and time:** count answer/search/read attempts separately. Queue-to-finished time includes waiting and investigation; it is not model inference time or a latency-reduction measurement.
- **Accounting:** keep planning reservations and available token usage separate from actual charges, which remain unavailable unless independently verified.

Human decisions remain pending until actually submitted. Report unchanged, worse, stopped, and unresolved cases alongside useful revisions. This small selected walkthrough cannot establish a population improvement rate, justify model fine-tuning, or promote a global answer policy.

## Engineering findings from preparation

Preparation exposed a physical-capacity routing error: the word “fit” made the kegerator question ask for a replacement-part model number. The routing fix distinguishes explicit capacity/size questions while retaining device compatibility and wrong-model source checks. It is a rules change with regression coverage, not evidence of a live quality gain.

Revision requests also now retain explicit AI-assisted feedback attribution, rather than automatically labeling every rejection as human. Local attribution is declared provenance, not authenticated proof of who wrote a critique. Human decision submission remains separate.
