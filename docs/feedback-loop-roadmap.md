# Product QA: feedback loop as the primary experiment

Status: original design, September 24, 2026. The local v0.2 implementation now covers this flow; see [its frozen protocol](feedback-loop-v0.2-protocol.md). A human-reviewed live improvement has not been measured.

## Objective

Measure whether reviewed development feedback produces better grounded answers on unseen product questions. The primary comparison is a frozen starting agent versus the agent after bounded feedback rounds. BM25/dense/hybrid comparisons are secondary diagnostics.

The learning mechanism is versioned prompt/configuration improvement. Model weights remain fixed. Every run produces a trace; only reviewed feedback becomes input to the optimizer. Model-generated answers are never automatically inserted as authoritative product evidence.

## Reusable foundation and missing work

The repo originally had SQLite persistence, answer review, experiment execution, and a proposal/challenger flow in `server/optimizations.ts`. The product-QA flow is implemented separately in `server/feedback-loop.ts` with detailed reviewed errors, version lineage, and a quality-first promotion decision. Browser-connected live product QA passed one answer smoke test; full live feedback evaluation remains human-review dependent.

Hybrid retrieval supplies the starting agent: the same product-filtered chunks feed BM25 and local embeddings, rankings merge through RRF, and a bounded evidence set goes to the fixed Sapiom answer model. Keep the corpus, chunking, embedding model, hybrid settings, and answer model fixed during the first feedback experiment.

## First complete local loop

1. Run V0 on a small development batch.
2. Review each answer against the available source evidence. Save correctness, evidence support, failure category, corrected behavior, supporting source IDs, reviewer identity, and the reviewed version.
3. An optimizer examines only reviewed development examples and proposes one bounded, generic answer-policy prompt change. It records the motivating feedback IDs and rationale. Product-specific answers and evaluation facts are forbidden in the policy.
4. Save an immutable candidate with its parent version, prompt diff, model and corpus versions, and proposal trace.
5. Run the candidate and current version on a fresh validation slice and a fixed regression suite. Reviewed semantic correctness is required; quote presence alone is insufficient.
6. Promote only when predefined quality and regression gates pass within the execution budget. Otherwise retain the current version and record the rejection. Inconclusive evidence does not count as improvement.
7. Repeat for a predetermined, bounded number of rounds. Preserve the original V0 and every promotion/rejection. Rollback selects an earlier immutable version.

The initial mutable surface is answer-policy instructions. Retrieval misses remain visible in the error log; changing retrieval parameters or adding reviewed product facts is a later, separately measured extension.

## Benchmark protocol

- Partition by product/family before development. Development feedback, validation, and final evaluation are separate. Audit near-duplicates.
- Use fresh validation slices per round plus the fixed regression suite. Cap optimization rounds and proposals before running; do not select endlessly against the same validation set.
- Keep final evaluation questions and labels out of development and candidate selection. Freeze the final policy before evaluating it against V0 on the same untouched questions.
- Primary result: paired change in grounded task success. Answerable cases require a correct, supported answer; cases genuinely lacking sufficient evidence require an appropriate insufficient-evidence response.
- Report answerable-case accuracy and answer coverage separately, plus unsupported-answer rate. Label sufficiency against the frozen evidence pool; an unlabeled retrieved passage is not automatically irrelevant.
- Report regressions, failed attempts, runtime latency, and both inference and optimization costs. Include uncertainty grouped by product/family when sample size permits; repeated runs are not new independent questions.
- Ten development cases demonstrate the loop. They cannot establish general improvement. No gain, rejected updates, and extra optimization cost are valid results.

## Local UI acceptance

The central flow is **review failure -> propose update -> inspect diff -> validate -> promote/reject -> inspect a different question**.

Show the evidence and feedback behind each proposal, the active version, version history, validation results, regressions, and rollback. Store reviews separately from the searchable product corpus. Braintrust can receive evaluation exports later; it is optional for the loop to work locally.

## Implementation order

1. Audited development corpus, product evidence storage, hybrid retrieval, and a live V0 answer path.
2. Structured review records and the detailed development-feedback input contract.
3. Bounded candidate proposer, immutable versions, and validation execution.
4. Quality/regression decision, promotion/rejection, rollback, and browser demonstration.
5. Untouched final comparison and an honest results report.
6. Optional retrieval ablations and Braintrust integration.

The earlier 8-14 hour estimate covered a hybrid QA/comparison prototype. A complete, verified feedback loop adds proposer, versioning, validation, and promotion work; it should not be represented as already included in that estimate.
