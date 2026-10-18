# Source-calibrated first answers: live comparison

October 18, 2026. **16 live answers completed across eight separate products. The result is a small exploratory AI-reviewed benefit, not an established general correctness gain.** No default or policy was activated; human source-checked judgments remain **0/16**.

## What changed

Saved development answers sometimes called compatible reports conflicting, turned tentative customer statements into definite conclusions, or repeated generic caveats. The experimental v2 first-answer instructions target source attribution, exact relationship scope, confidence and the precise remaining gap. The ordinary v1 default is unchanged.

Candidate instructions were frozen before source-only selection. Both arms received the same question, model route, policy, ordered retrieved source bodies, citation options, response schema and answer-length bound. Arm order alternated. The packet contains eight distinct products, 161 reviewer source parents and 39 selected source bodies; independent AI source/family review passed before generation. Two rejected preparation drafts remain preserved and excluded. There were no repairs, grader calls, web calls, retries or case replacements.

## Answer assessment

Two fresh AI contexts independently reviewed anonymous A/B answers against complete sources and prewritten references. They evaluated substantive support/coverage/calibration separately from wording. Assignment was revealed only after their files were saved.

| Assessment | Candidate preferred | Baseline preferred | Ties | Disputed between reviewers |
| --- | ---: | ---: | ---: | ---: |
| Primary substantive review | 1 | 0 | 7 | — |
| Secondary substantive review | 2 | 0 | 6 | — |
| Agreement between reviews | 1 | 0 | 6 | 1 |
| Wording, each reviewer | 6 | 2 | 0 | 0 |

- **Agreed useful-coverage benefit — PS2:** the candidate preserves the customer's tentative region/alteration caveat. The baseline omits this useful condition. Both correctly leave exact SCPH-77004 compatibility unresolved.
- **Disputed benefit — Viking:** the baseline calls fit reports about different or unspecified models conflicting. The candidate calls them mixed and explicitly preserves their scope. One reviewer treats that as a substantive calibration improvement; the other treats it as a wording preference. The disagreement is retained.
- **Remaining shared gap — Toyota:** full saved sources contain item dimensions that retrieval omitted. Those dimensions still cannot establish a YZZ01/YZZ02 fit comparison. Both answers also miss a visible title/model-name qualification. Prompt changes alone did not resolve these gaps.

Neither AI reviewer preferred the baseline substantively or flagged a new material unsupported candidate claim. This is not a verified correctness rate. AI references themselves needed corrections concerning Toyota dimensions, model-scoped Viking reports and some color/PS2-version details. Original references and both correction records remain inspectable; no prompt tuning, case replacement or silent reference rewrite followed.

The word “evidence” appears in 5/8 baseline answers and 1/8 candidate answers. That is a wording count, not an accuracy measurement.

## Execution, citations and resources

All 16 planned calls completed on the reported model `gpt-5.6-luna` through the frozen `gpt-luna` route. Exact receipts/checkpoints replay locally; bound code, source files, history and pre-existing ledger rows were unchanged during execution. All **39/39 citation occurrences** match the exact offered source bodies. Literal membership does not establish semantic support or answer correctness.

| Recorded measure | Baseline, 8 answers | Candidate, 8 answers |
| --- | ---: | ---: |
| Input tokens | 13,380 | 15,332 |
| Output tokens | 1,040 | 974 |
| Citation occurrences | 20 | 19 |
| Median local operation time | 3,132.5 ms | 2,675 ms |
| Reserved planning allowance | $0.80 | $0.80 |

Local operation time runs from the adapter's pre-provider start to its observed return, including reservation, generation and validation. It excludes retrieval and is neither time to first token nor a repeated latency benchmark. Candidate instructions use more input tokens; shorter output does **not** establish cost savings. Settled charges and provider-enforced spending limits are unavailable.

The exact approved addition was 16 attempts / $1.60 local planning allowance. The shared ledger moved from 122 to **138 attempts**, with **$13.80 reserved + $0.200281 prior adjustment = $14.000281** combined planning usage under the $20 local cap. It ended with zero pending reservations and zero owners. No additional Router calls were used for review.

## Inspect and reproduce

- [Frozen proposal and budget](bounded-plan-v2.json), [candidate instruction commitment](candidate-freeze-v1.json), [cohort](cohort-v1.json), [retrieval](retrieval-v1.json), [pre-generation source/family references](source-family-review-v1.json).
- [Approval and execution commitments](live-execution-record-v1.json), [raw live outputs](live-result-v1.json), [local execution verification](execution-verification-v1.json), [literal citation replay](literal-citation-replay-v1.json).
- [Anonymous answers and complete sources](anonymous-review-v1.md), [primary AI review](blind-ai-review-primary-v1.json), [secondary AI review](blind-ai-review-secondary-v1.json), [assignment](arm-mapping-v1.json), [unblinded assessment and disagreements](comparison-assessment-v1.json).

From the repository root, reproduce the public literal citation count without credentials, dependencies or provider calls:

```sh
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const dir = 'docs/evidence/answer-quality-source-calibration-2026-10-18';
const read = name => JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
const result = read('live-result-v1.json'), retrieval = read('retrieval-v1.json');
let citations = 0;
for (const step of result.steps) {
  assert.equal(step.status, 'completed');
  const sources = retrieval.results.find(x => x.caseId === step.caseId).retrieval.passages;
  for (const cite of step.output.answer.citations) {
    assert.ok(sources.some(s => s.id === cite.passageId && s.text === cite.quote));
    citations++;
  }
}
assert.equal(result.completedAnswers, 16);
assert.equal(citations, 39);
console.log({ answers: result.completedAnswers, matchingCitationOccurrences: citations });
JS
```

This verifies source-body membership only. Private checkpoint replay additionally verifies receipts and bindings; public files do not independently authenticate provider origin. Publishing outcomes creates new exposure, so the consumed live plan is not a reusable preflight for another run.

## Decision

Keep the candidate experimental. Eight products, one observation per arm and two potentially correlated AI reviewers are insufficient for broad quality, human-reviewed gain, whole-workflow correction benefit or a learning-curve claim. Grader qualification and policy activation remain closed.

The next development target is retrieval coverage for relevant structured attributes and exact model relationships. These eight products are now exposed development cases; any subsequent comparative test needs newly frozen, product-family-disjoint questions.
