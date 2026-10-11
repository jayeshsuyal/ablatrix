# Correction-policy experiment

Approved scope, October 10, 2026: up to **six development attempts**, then **24 conditional fresh-product attempts** (eight products × one shared original and two sibling revisions). The total maximum is **30 new attempts / $3 local planning allowance**. The starting shared ledger contains 63 attempts; the temporary absolute limit is 93, within the existing $10 local plan including its $0.200281 prior-spend input. Actual provider charges are unavailable. Web discovery and automatic retries remain disabled.

## Hypothesis and implementation

A versioned revision-only prompt can improve the use of explicit listing facts and capacities while preserving appropriate uncertainty about exact-model compatibility and conflicting sources. It should also avoid asking for already supplied identifiers, machine status tokens in prose, and speculation about unseen images.

The baseline is the current revision system instruction. `candidate_v4` is explicitly selected only by the evaluation runner. First-pass answer instructions and ordinary product revision jobs retain their current default. The experiment does not modify saved answers or submit human decisions. It does not promote a policy automatically.

Both comparison arms receive the same initial answer, critique, ordered selected sources, original customer-question metadata, clarifications, and frozen investigation context. The revision instructions and their version label differ. Model route, generation settings, structured output schema, exact-quote validation, and output handling are shared. Actual request bodies and hashes are recorded before dispatch. The candidate never revises the control revision; each revises the same original.

## Development gate

The [development plan](evidence/correction-policy-2026-10-10/development-plan.json), frozen in commit `54e1982` before dispatch, binds exact inputs, criteria, prompt identities, code hashes, and limits for previously inspected cases Q26, Q63, Q19, Q47, Q75, and Q4. Q26/Q63 reuse the exact model inputs of the October 10 baseline attempts, apart from the run ID and selected revision instructions. Other cases are candidate qualification probes, not matched quality comparisons. The Q19/Q47 probes deliberately test the generator against missing or wrong-model evidence; they do not override production investigation stops.

Required gate:

- Every returned citation is an exact span of the supplied source body; answered responses have citations.
- Independent AI source review passes every frozen case criterion, including direct listed-capacity wording, preserved uncertainty, and retained supported customer attribution.
- No material unsupported claim, internal status token in prose, or redundant request for a supplied model is introduced.
- Any provider uncertainty, invalid response, failed criterion, or unresolved AI assessment stops this experiment before fresh-product generation. Preserve all outcomes; do not retune and rerun within the same frozen round.

The AI gate decides whether to spend the already-approved conditional validation allowance. It is not a human quality result or a promotion gate.

**Recorded outcome:** all six calls completed; all 18 returned citation quotes matched the supplied source bodies. The [AI source check](evidence/correction-policy-2026-10-10/development-ai-review.md) passed the frozen criteria, while noting remaining verbosity. [Raw outputs](evidence/correction-policy-2026-10-10/development-results.json) and the [machine-readable gate](evidence/correction-policy-2026-10-10/development-gate.json) are preserved. No human judgment or policy promotion followed this gate.

## Conditional fresh comparison

Only after development passes, freeze eight new products and the complete execution manifest before generating any fresh answer. Exclude the 56 historical products, subsequent workspace/experiment exposures, matching product families, and near-duplicate source pools. Keep the remaining legacy validation products and the final corpus reserved for their original protocol. Preserve dataset provenance, selection seed/rules, eligibility exclusions, source context, and the family audit. Dataset reference answers and relevance labels must not enter retrieval or generation.

Use the existing hybrid retriever once per question, freeze at most eight selected source chunks, and retain the complete eligible review pool separately. Bound the pool to 128 chunks and exclude a whole product if its complete context cannot be represented within the protocol. This is a stratified small development-stage validation cohort, not a random population estimate.

Generate one current-baseline original per product. Then apply a prewritten, source-checking critique rule to both revision arms; do not select or replace products based on whether the initial answer looks bad. Retain already-good answers as controls. Alternate which revision arm runs first and conceal arm mapping independently in the review workbench. Each provider attempt gets its own receipt; an unknown or invalid outcome stops the run without retries or replacement cases.

## Review and reporting

Use the tagged correction-policy format in `/compare`; do not label this as the original-question metadata ablation. The two experiments have different controlled inputs. The shared original and AI-authored critique stay hidden during independent final answer review to avoid presenting AI review suggestions as part of the human judgment.

A person must source-check all 16 revised answers anonymously for correctness, support, and adequacy. Mechanical citation membership and model-reported status remain separate. Keep uncertain judgments unresolved and failures visible against the eight-product denominator. An initial favorable signal requires more fully correct, supported, adequate candidate answers and no new unsupported-claim regressions in this sample. Eight products cannot establish broad generalization; no automatic policy promotion follows.

Imported records remain retrospectively supplied and unauthenticated as provider records in the workbench, even when a separate public pre-generation manifest exists. Keep that provenance limitation. If the gate fails or review remains incomplete, publish the failure or pending state rather than a quality-gain claim.
