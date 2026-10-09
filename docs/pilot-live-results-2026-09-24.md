# Live search ablation: first measured batch

Date: 2026-09-24. Local evidence: `outputs/pilot-live-batch-1790283160661.json` (ignored by Git; contains answers and request IDs, no credential). The [public per-call measurements](evidence/search-ablation-2026-09-24.csv) omit answers and request IDs while retaining the 32 timings, arm assignments, call counts, token counts, and model IDs needed to recompute the reported latency and meter-derived cost. Frozen suite SHA-256: `d68f066051c6fd3d3e69123f88a540b8eee534c56d2c24d23614b6d51fbccd0d`. Search agent: `ablatrix-pilot-search`, definition `873`, ready build `2221`.

## Question and setup

Does an extra web-search hypothesis help answer a GitHub Actions documentation question when both arms already receive the same sufficient official excerpt? Eight distinct evaluation questions were each run twice. Adjacent arm order was randomized by saved seed. Both arms used the same Router request alias `gpt-luna`, returned `gpt-5.6-luna`, lane `run_now`, 4,096-token ceiling, `reasoning_effort: none`, structured output tool, prompt, and frozen source. Only the baseline invoked one Sapiom web search before the answer call. Its hypothesis was untrusted context. The candidate supplied an empty hypothesis.

The search ran through a separate deployed Sapiom agent; answers ran through direct Sapiom Router. Timing starts before the optional agent invocation and ends after the Router response. Thus the measured search cost includes agent dispatch and runtime overhead. Source collection happened before both arms and is excluded.

## Observed result

| Measure | Search on | Search off |
| --- | ---: | ---: |
| Completed answers | 16/16 | 16/16 |
| Web search calls | 16 | 0 |
| Router calls | 16 | 16 |
| Median answer-stage time | 8.86 s | 1.70 s |
| Router input / output tokens | 9,597 / 1,914 | 8,036 / 1,876 |
| Meter-derived cost | $0.100216 | $0.003858 |

Search off was faster in all 16 matched pairs. The median of the 16 paired percentage reductions was **81.2%**; the cost reduction from the visible meters was about **96.2%**. These are observations for this narrow workflow, not a general performance guarantee. The eight questions, rather than the 16 repetitions, are the independent tasks.

To recompute, pair rows by `task_id` and `repetition`, then take the median of `(search-on duration_ms - search-off duration_ms) / search-on duration_ms`. For cost, sum `search_calls × $0.006 + input_tokens × $0.20 / 1,000,000 + output_tokens × $1.20 / 1,000,000` by arm; `(search-on total - search-off total) / search-on total` is **96.15%**. This is a ratio of aggregate metered costs, not a median paired cost reduction.

The Sapiom billing page showed 4 to 20 `search.web` units, 5 to 21 included agent runs, and accrued account usage of $0.096206 immediately before the batch versus $0.200281 afterward: a $0.104075 increase. The published on-page rates at inspection were $0.006 per search, $0.20 per million `gpt-5.6-luna` input tokens, and $1.20 per million output tokens. Applying those rates to the saved token counts gives $0.1040746 total ($0.096 search + $0.0080746 Router), consistent with the billing delta after rounding. This is meter-derived aggregate cost, not a settled per-request receipt. The displayed account balance was $14.93 after the batch; it is rounded and lags accrued usage.

All 32 answers parsed, returned the same model identifier, and cited exact text in their frozen source. Agent inspection of the 32 answers against the eight reference labels found the expected facts in both arms. Independent blind human review of correctness and reference labels has **not** happened, so the experiment's quality gate and final accept/reject decision remain pending. These questions were selected so their supplied excerpt contained the answer; the pilot does not measure search for missing evidence, retrieval, or open-domain research.

## Reproduction boundary

The live batch was a standalone exploratory harness, not a `/pilot` production-provider run. The app's live button remains disabled because it still requires a verified Sapiom-enforced cap and settled per-call charge contract; the user explicitly waived the remote-ceiling requirement for this exploratory batch while keeping a $10 total spending limit. The harness reserved $0.10 locally per planned call against that limit and stopped on a failed or changed-model result. No key was written to the repo or evidence file. The saved JSON contains the seed, source hash, per-call timing, response, model, token counts, search execution IDs, and Router request IDs.

Before this batch, the first real matched smoke pair also completed on the same question (2.14 s search off; 8.89 s search on). Two earlier Router preflight requests were rejected with HTTP 400 because the default `gpt-luna` reasoning setting does not support function tools on Chat Completions. Adding `reasoning_effort: none` resolved that error for both arms. The smoke pair is excluded from the 32-call result above.
