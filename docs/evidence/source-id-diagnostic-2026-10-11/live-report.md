# Six-call citation delivery diagnostic

On October 11, 2026, the approved `source_ids_v2` diagnostic **stopped** after **5/6 planned attempts**. **4 outputs were accepted**, and **12/12 selected citations matched complete offered source bodies**. Selection occurred in **4/6 requests**; **2/3 case-specific targets** were observed.

The [immutable version 3 plan](execution-plan-v3.json) was published before dispatch and binds implementation `9cba21c6ecf6cb700ac01a990a65576f0b83b293`, source/audit/qualification hashes and exact request identities. [Versions 1 and 2 remain unused](plan-supersession-v3.md); two bot findings were repaired before spending any calls. [Machine-readable results](live-summary.json) contain per-call request, schema, catalog and receipt hashes, IDs, status, timing and usage. Successful answer prose remains private.

## What ran

Three previously exposed public contexts, fixed five-source retrieval and AI-authored critiques were reused. The plan called for a new original followed by one baseline revision of that actual original per case. The first two cases completed both steps; Q8746 stopped during original-output validation. No candidate policy, new source retrieval, web call, retry, ID repair, replacement, comparison import or policy promotion occurred.

| Case | Original | Baseline revision | Exact citation matches | Target selection |
| --- | --- | --- | --- | --- |
| Q10021 | accepted | accepted | 8 | observed |
| Q12820 | accepted | accepted | 4 | observed |
| Q8746 | failed/uncertain | not attempted | 0 | inconclusive |

Targets: Q10021's source whose ID was previously shortened; Q12820's complete 289-character structured package-dimensions source; Q8746's customer-answer group whose original questions name other laptop models. Offering a target does not establish its selection. Any unselected target remains inconclusive; the six-call ceiling is unchanged.

Stop reason: A request, receipt or output validation failed; no retry or replacement. **1 step stayed unattempted**; the full six-step denominator is retained.

The Q8746 original returned HTTP 200 with two offered IDs, but `citations` contained strings rather than the required `{quoteId: ...}` objects. The provider receipt records `output_validation`. The IDs were not unknown; the invalid container shape was rejected without coercion. Its baseline revision was never attempted, and its target coverage remains inconclusive. This response shows that declaring the schema did not prevent this invalid shape in the diagnostic.

## Accounting and integrity

The shared ledger moved **81→86**, with **0 pending reservations**. These attempts reserved **$0.50** added local planning allowance, within the approved **$0.60 maximum** and existing **$10 planning cap**. Settled provider charges are unavailable; this is not a provider-enforced ceiling.

Saved receipts contain token usage for 5 attempts: 9934 input and 777 output tokens. Per-call duration includes generation, local checks and persistence; it is not an app retrieval benchmark or a measured latency reduction.

Earlier receipts and six review tables retained their hashes. All 33 historical evidence files, the stopped private result and unused preparation records remained unchanged. The runner retained 16/16 passing shutdown/history checks and 0 failed checks at its recorded reservation, transport and response boundaries. These checks detect observed restarts; an external process can start during an in-flight request, and a spent attempt cannot be undone. Localhost was restored on port 4194 with live calls, web investigation and Langfuse disabled.

## Interpretation

This small, exposed diagnostic establishes observed request delivery, validated output and exact source membership for the calls reported. It does not establish claim support, answer correctness, human preference, general failure probability or a causal improvement from the enum. Both prompt guidance and the citation schema changed, and **Router-enforced constrained decoding remains unverified**.

**Zero new human judgments. No answer-quality gain claimed.** A quality comparison still requires a separately frozen fresh cohort and independent source-checked human review. Missing citation/target coverage remains inconclusive and does not authorize more calls. Public receipt metadata and private result hashes are not independent authentication of provider billing or response authenticity.

Private result SHA-256: `72aa6bb01db59fc3a744aac9e3251b91d178e016ce68320673ecd8f9fa015386`. Plan SHA-256: `5239294ddec363335de2b176afa5df58ce16204ebbafeb31a976001c881a7164`.
