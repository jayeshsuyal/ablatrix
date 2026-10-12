# Prospective quality comparison with flat source IDs

**Status: design implemented in the [prepared comparison](flat-source-quality-comparison.md).** This document describes the protocol; its linked evidence supplies the audited source snapshot and execution manifest. Paid authorization and quality results remain pending. Qualify the additive `source_ids_v3` interface offline before selecting and freezing fresh cases. The [stopped citation diagnostic](evidence/source-id-diagnostic-2026-10-11/live-report.md) remains a stopped, exposed-case diagnostic with zero human quality judgments.

## Question and controlled change

Does the existing `candidate_v4` revision policy produce more correct, supported and adequate answers than the baseline revision policy, while preserving appropriate uncertainty and avoiding new unsupported claims?

This tests the **candidate policy bundle** in [revision-policy.ts](../server/revision-policy.ts): attributed listing facts, conflict handling, exact-model scope, requests for genuinely missing information and natural wording. It cannot isolate the effect of one sentence or the citation format. Both arms must use the same qualified flat `source_ids_v3` interface.

Use the existing [correction packet and blind review workbench](context-comparison-contract.md). A fixed, rubric-only AI-authored critique is shared across both arms and frozen before generation. This evaluates correction under common rubric guidance; it does not demonstrate learning from human feedback or model fine-tuning.

## Proposed sample and source gate

Eight distinct products, with one question per product:

| Stratum | Products | Intended check |
| --- | ---: | --- |
| Capacity or dimensions | 2 | State documented facts with attribution; retain conflicts and limits on physical fit. |
| Appearance or material | 2 | Preserve supported specifications and appropriately scoped customer descriptions. |
| Model scope | 2 | Do not transfer a customer answer to a different model or part. |
| Missing information | 1 | Identify the actual missing support without inventing a relationship. |
| Simple factual control | 1 | Preserve a supported answer without unnecessary changes. The original's quality is unknown before generation. |

Use a new prospective seed and deterministic ranking over the pinned ePQA train corpus. Retain the original customer questions, source provenance and complete eligible source pools, including distractors and conflicting reports. No relevance labels, reference answers, generated outcomes or test-split data enter selection or retrieval. The previous [source preparation](evidence/source-id-correction-2026-10-10/preparation.md) recorded 4,278 eligible full pools; updated eligibility must be checked again before claiming a feasible fresh cohort.

Before any generation:

1. Publish an updated exposure inventory. Exclude at least **81 distinct publicly inspected products**: the previous 67-product protected set plus the union of both later source-preparation drafts and the final eight-product cohort. Also record the manually rejected `B00B8Q31UQ` and current workspace/comparison exposures. Exclude all planned products from stopped rounds, including unattempted cases. Keep the two legacy validation products and final corpus reserved.
2. Audit full source, question and title identifiers, manufacturer/brand families, alternate parts and near-duplicate source pools against protected and selected products. Record every deterministic eligibility rejection. Exact ASIN checks alone do not establish family independence.
3. Retrieve once with the existing hybrid retriever, then freeze the ordered generation sources for all three calls. Preserve a separate full reviewer pool: at most 128 chunks, at most eight generation sources, and all current source/body bounds. Reject an unrepresentable product as a whole; do not silently clip context.
4. Source-check the frozen retrieval for direct support, missing support, conflicts and CQA scope. Record relevant material omitted from retrieval. Apply eligibility uniformly before outputs exist; do not replace a case because its answer later looks difficult or already good.

Missing support and conflicts remain valid probes. For example, the exposed Q12820 context has conflicting raw/normalized dimensions, differently scoped customer answers and omitted item dimensions. A change from `insufficient_evidence` to `answered` does not establish improvement. The rubric must reward supported facts and calibrated uncertainty rather than unconditional answering.

## Generation and stopping rules

The proposed maximum is **24 attempts**: eight shared originals plus sixteen sibling revisions. Freeze code, source/audit hashes, model route and settings, original policy, both revision policies, critique, source catalogs, flat schemas and request-construction rules before dispatch.

- Generate each original through v3; retain its complete answer and receipt. Both revision arms receive that same actual original, question, source context and AI critique. The candidate never revises the baseline revision.
- Generate all eight originals first, stopping on the first failure. Then alternate which revision arm runs first within each product pair. Keep the model, citation interface, selected sources, clarifications and investigation descriptor equal; only the revision policy bundle and its version label differ.
- Stop on the first invalid/uncertain output, dispatch, receipt, identity, persistence or execution-safety failure. No web calls, retries, coercion, replacement cases or extra attempts.
- Preserve all eight cases and 24 planned steps in the execution record. Failed or unattempted arms never become ties. The existing importer requires a completed shared original; if an original fails, retain the full execution record externally and do not import a reduced cohort as the planned comparison.

## Review and decision gate

Reviewers use `/compare` to inspect the full source pool and **16 anonymous revised answers**, independently checking correctness, source support and adequacy. The workbench hides arm identities, the shared original, AI critique and generation metadata until judgments are saved. AI critique is a generation input, never a human judgment. Reviewers must make their own source checks without AI-suggested verdicts.

Report separate per-axis counts and the number of answers positive on **all three** axes. Show paired wins, losses, ties, unsupported/incorrect regressions, uncertain pairs and pending judgments. Use the report’s separate `pairedAxisRegressions` counts for correctness and support, including resolved, uncertain and pending denominators. The aggregate `quality.regressions` counts all-three-positive losses and cannot substitute for those checks. Uncertainty on another axis does not hide an observed correctness or support regression. A favorable descriptive signal requires more all-three-positive candidate answers and no new incorrect or unsupported regressions in this sample. Unresolved judgments remain inconclusive; missing attempts leave the comparison incomplete.

Exact citation membership, model status and human-reviewed quality remain distinct. Eight products provide an exploratory signal, not broad generalization or automatic policy promotion. Keep the existing imported-live provenance, `qualityClaimEligible: false` and absent confidence interval: the importer does not authenticate provider responses or independently prove prospectivity, even when a public pre-generation manifest accompanies it.

## Required preparation work and budget approval

Build an additive preparation/execution path; preserve earlier scripts and frozen evidence. The current [source preparer](../scripts/prepare-source-id-cohort.py) binds an old seed, a 67-product exposure baseline, v1 citation metadata and ledger 73. The [old comparison runner](../scripts/source-id-comparison.ts) hardcodes that cohort, v1 methods, limits 73→97 and the superseded port-4194-only shutdown check. Neither is a current execution route for this design.

Reuse the existing correction packet, retriever and workbench. The new path must select v3 explicitly for the original and both arms, qualify request reconstruction/import/blinding offline, bind the updated exposure audit, and retain the newer runner's private checkpoints and repeated application/history checks. Boundary checks detect activity; they cannot prevent an external process starting during a spent in-flight request.

The [latest public ledger record](evidence/source-id-diagnostic-2026-10-11/live-summary.json) ends at **86 attempts**. At the retained $0.10-per-attempt planning allowance and $0.200281 prior-spend adjustment, a proposed 24-call round would mean:

`86 + 24 = 110 attempts; 110 × $0.10 + $0.200281 = $11.200281`

That proposes **$2.40 additional allowance** and exceeds the existing $10 planning cap and last approved 87-attempt ceiling. Recheck ledger state before a future freeze and obtain explicit approval for the new bounded round, proposed $12 local planning cap and 110-attempt ceiling. Unused authority from a stopped run does not authorize this comparison. Allowances are local reservations; settled provider charges remain unavailable.

**Preparation is recorded separately** in the [comparison record](flat-source-quality-comparison.md), including source-only draft repairs and qualification. Paid execution and independent human review remain subsequent gates. No new experiment framework, production-policy change or quality claim is required to complete the offline slice.
