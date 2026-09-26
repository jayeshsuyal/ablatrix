# Ablatrix v0.2: measured feedback protocol

## Question

Can a generic answer-policy update derived from reviewed product-QA failures improve supported correctness on products it never saw during development? The model, retrieval method, source snapshot, and prompt surface are fixed. Only the answer-policy instructions may change.

## Frozen material

- Development: ten product-disjoint questions in the original pinned ePQA corpus. The batch freezes case IDs, product IDs, questions, active policy ID, corpus version, and a SHA256 manifest before execution. Only reviewed failures from the active policy can drive a proposal. One batch per policy version is allowed.
- Validation: six separate products, two fresh products per candidate round, plus up to two previously reviewed correct development cases as regression checks. At most three proposal rounds. Both policies receive identical retrieved passages per question.
- Final: 20 new ASINs and 498 passages from the pinned upstream train CSV. The test CSV is untouched. `final-manifest.json` stores the selection seed/rule and row provenance. The final corpus is loaded separately and excluded from proposal input. It contains no answer labels. The first-title-token family filter is a heuristic, and independent family/source audit remains pending.

## Execution and review

1. Run the frozen development batch. The live provider reserves one planning allowance per attempted call and does not automatically retry failures. Review each answer against the complete product evidence, recording correctness, support, a correction and source IDs where needed, and reviewer identity.
2. Create one generic policy proposal from reviewed development failures. Inspect its parent, rationale, and saved feedback IDs.
3. Run the small validation. The app randomizes anonymous A/B cards per question and hides policy/run association, model identity, timing, and token usage in public API responses until all reviews are saved and the promotion decision is made. The original/candidate policy names remain inspectable as versioned artifacts, but no review card identifies its arm.
4. Promote only for a strict supported-correctness gain on the two fresh validation products with zero observed paired regressions across fresh products and previously reviewed development controls. Controls do not contribute to the required gain. A rejection is saved; validation questions are never reused in another round.
5. Freeze the promoted policy and compare it with the original baseline on the 20 final products. Each pair reuses one retrieval result and alternates answer order. The live path checks capacity for all 40 answer calls before starting. The user reviews each randomized A/B card against its product evidence; no summary result is released until all 40 have explicit human reviews. Fixture reviews and scores are labeled synthetic.

Restart marks an interrupted batch or final comparison and preserves attempted calls. A final comparison is attempted once per workspace across fixture and live modes because starting either mode exposes the same final holdout. A later final comparison needs a separate sealed corpus and workspace. The local planning allowance is not a billed-cost guarantee; actual billed cost is shown as unavailable.

## Report and interpretation

The final report saves per-product reviewed outcomes, original/candidate supported-correct counts, wins, regressions, ties, answer coverage, unsupported answers, median latency, tokens where available, and a deterministic paired bootstrap 95% interval for the percentage-point difference. The bootstrap draws product pairs independently with replacement from a hash-seeded stream. It records the frozen manifest and the policy lineage in the export. A 20-product purposive historical sample is exploratory; the bootstrap interval does not establish performance on all shopping questions. Inconclusive or worse outcomes remain valid results. No live gain is claimed until a full human-reviewed comparison finishes.

## Local verification

- The implementation has a separate 20-product corpus with verified passage hashes, no answer labels, and no product overlap with development/validation.
- Real BGE preparation passed for all 20 final products and 498 passages, in addition to the existing 16 products and 304 passages.
- Synthetic browser flow exercised the 40-answer final comparison, report, export, reload, and existing rollback flow. Synthetic scores only validate orchestration.
- Full verification passed: 76 repository tests, eight Chromium checks, and production TypeScript/Vite build, including separation of AI drafts from human feedback. The first live answer smoke is documented in [v0.1 evidence](feedback-loop-v0.1-evidence.md).

## Live development batch: 2026-09-25 UTC

The approved ten-question Sapiom batch completed on the local app (`http://127.0.0.1:4189/loop`). Batch ID: `3c53c6ba-5e16-47b5-8161-6ba9d6319e28`. Frozen manifest SHA256: `03df3be9af26333552959003445436cd634ad0136f81bbe27fea5c325b65d241`. The active policy was `live-baseline`; all ten product-disjoint attempts returned completed runs from `gpt-5.6-luna`.

Eight answers were classified by the model as `answered` and two as `insufficient_evidence`. The runs produced 29 citations. A mechanical check confirmed that all cited passage IDs were in each run's retrieved set and all quoted spans occurred exactly in those passages. Median model-call latency was 2,660.5 ms. Provider-reported usage totaled 7,069 input tokens and 2,183 output tokens. The local budget ledger moved from one to eleven planned calls out of 60; that count uses a $0.10 planning allowance per call and is **not** actual billed cost. Sapiom billed charges were unavailable.

These are execution and citation-integrity measurements, not answer-quality scores. None of the ten answers has a reviewer correctness/support judgment yet. The next step is source-grounded review in the saved batch queue. A policy proposal and blind validation can then use reviewed failures; the 20-product live final remains sealed until a candidate is promoted.

Subsequent [AI draft review](feedback-loop-v0.2-development-review.md) assessed all 234 development-product passages: nine answers appear correct/supported, and one may abstain unnecessarily despite explicit material evidence. All ten drafts are saved separately from feedback and appear beside their answers. They are not human judgments and cannot feed proposals or satisfy promotion/report gates. When a person saves a review after seeing a draft, its draft ID is retained to disclose AI assistance. Validation and final answers do not accept these development drafts.

A [two-call exploratory policy check](feedback-loop-v0.2-shadow-check.md) tested that disputed abstention and a conflicting-authenticity control using saved retrieval passages. Both candidate answers still used `insufficient_evidence`; the check did not establish improvement or change the official policy state. Human review remains the next gate.

A [second two-call exploratory check](feedback-loop-v0.2-shadow-revision2.md) replaced the broad abstention wording. The cabinet response became a clearer qualified partial answer, but did not verify real glass. The Native Union response disclosed conflicting authenticity reports, yet marked the whole response `answered`, a possible overstatement. This is inconclusive, did not change the official policy, and does not replace human review.
